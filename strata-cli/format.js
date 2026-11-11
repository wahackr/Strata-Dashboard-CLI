// Number formatting, sparklines, bars and color. The number helpers are ported
// from renderer/renderer.js so the terminal and the widget say the same thing
// about the same payload.
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

// The ASCII sparkline scale, quiet to loud. A blank cell means "no traffic",
// which is what makes a zero-value run read as empty rather than as a row of
// commas sitting on a baseline. Ordered the same way as BLOCKS: one cell per
// step, always ASCII, so it survives a framebuffer with no block glyphs.
const ASCII_SPARK = [" ", ".", "-", "=", "+", "*", "#"];

const PALETTES = {
  dark: {
    text: "#f2f5ec", muted: "#92998c", accent: "#b8f36b", good: "#b8f36b",
    warn: "#ffbf69", bad: "#ff716d", border: "#394034", card: "#1e221c",
  },
  light: {
    text: "#171d13", muted: "#656d5b", accent: "#3f7d16", good: "#3f7d16",
    warn: "#a86a10", bad: "#c0403b", border: "#c9d3ba", card: "#ffffff",
  },
};

const STATE_ROLE = {
  idle: "muted", reading: "accent", generating: "good", queued: "warn", error: "bad",
};

// Named ANSI colors per role, for terminals that cannot render 24-bit. The
// index is chosen by meaning, never by distance: PALETTES.dark.accent is lime
// (#b8f36b), whose nearest 16-color neighbour is yellow, so quantizing the hex
// is exactly what makes the accent read yellow on plain terminals (Alpine's
// tty, TERM=linux, tmux without `colours=truecolor`). Green is the promise.
// `console` is the kernel console (linux tty, cp437 font, 8 foreground colors)
// standing in for the role; roles without it keep their plain `ansi` code, so
// the light theme is untouched. Only the low-contrast roles need a bump: 90 is
// bright-black, which on a black console is barely legible.
const ANSI_BY_ROLE = {
  dark: {
    text: { ansi: 97, x256: 15 }, muted: { ansi: 90, x256: 8, console: 37 },
    accent: { ansi: 92, x256: 10 }, good: { ansi: 92, x256: 10 },
    warn: { ansi: 93, x256: 11 }, bad: { ansi: 91, x256: 9 },
    border: { ansi: 90, x256: 8, console: 36 }, card: { ansi: 97, x256: 15 },
  },
  light: {
    text: { ansi: 30, x256: 0 }, muted: { ansi: 90, x256: 7 },
    accent: { ansi: 32, x256: 2 }, good: { ansi: 32, x256: 2 },
    warn: { ansi: 33, x256: 3 }, bad: { ansi: 31, x256: 1 },
    border: { ansi: 90, x256: 7 }, card: { ansi: 30, x256: 15 },
  },
};

// paint() only ever receives a palette hex, so one hex -> code table covers
// both themes: accent and good share a hex per theme, and no hex is reused
// across themes.
const CODE_BY_HEX = new Map();
for (const theme of Object.keys(ANSI_BY_ROLE)) {
  for (const [role, code] of Object.entries(ANSI_BY_ROLE[theme])) {
    const hex = PALETTES[theme][role];
    if (hex) CODE_BY_HEX.set(hex.toLowerCase(), code);
  }
}

// Accepted values for --color and colorMode().
const COLOR_MODES = ["auto", "16", "256", "truecolor", "console", "never", "off"];

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The palette hex when the terminal speaks 24-bit, otherwise the named color
// standing in for it. Off is the identity, so widths stay exact either way.
function paint(text, hex, mode) {
  if (!mode || !hex) return text;
  if (mode === true || mode === "truecolor") {
    const [r, g, b] = hexToRgb(hex);
    return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
  }
  const code = CODE_BY_HEX.get(String(hex).toLowerCase());
  if (!code) return text;
  // The kernel console answers to the plain foreground codes. Muted and border
  // carry a console-specific code; the status colors keep their recognizable
  // 91/92/93, so good/warn/bad still mean the same thing there.
  if (mode === "console") return `\x1b[${code.console ?? code.ansi}m${text}\x1b[39m`;
  // The 16-color codes are already SGR foregrounds (30-37, 90-97); a palette
  // index needs the 38;5; prefix. Emitting the bare index is a different verb:
  // \x1b[8m is conceal, \x1b[10m is primary background, \x1b[15m is not a color
  // at all — which is why a TERM=*256color terminal with no COLORTERM showed an
  // empty screen. paint() closes with 39 (foreground only), so conceal would
  // never lift.
  return `\x1b[${mode === "256" ? `38;5;${code.x256}` : code.ansi}m${text}\x1b[39m`;
}

// What the terminal advertises, strongest signal first. Only COLORTERM says
// 38;2 is understood; TERM=linux and a bare TERM=xterm get the 16-color names.
function colorCapability(env) {
  // The kernel console is its own thing: 8 colors, a cp437 font, no 38;2. An
  // inherited COLORTERM=truecolor (a shell profile, or tmux driven from a real
  // terminal elsewhere) describes something other than the framebuffer in
  // front of the user, so this check comes before COLORTERM.
  if (/^linux$/i.test(String(env.TERM || ""))) return "console";
  const colorterm = String(env.COLORTERM || "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
  if (/256color|direct/.test(String(env.TERM || "").toLowerCase())) return "256";
  return "16";
}

// A --color flag plus the environment, resolved into a paint() mode or false.
// Auto colors a terminal and keeps pipes plain, honoring NO_COLOR/FORCE_COLOR
// as the wider ecosystem defines them.
function colorMode(flag, env = process.env, isTTY = Boolean(process.stdout.isTTY)) {
  if (flag === false) return false;
  if (typeof flag === "string") {
    if (flag === "16" || flag === "256" || flag === "truecolor" || flag === "console") return flag;
    if (flag === "never" || flag === "off") return false;
  }
  if (flag === true) return colorCapability(env); // an explicit --color wins
  if (env.NO_COLOR) return false;
  if (/^(0|false|none)$/i.test(String(env.FORCE_COLOR || ""))) return false;
  if (!isTTY && !env.FORCE_COLOR) return false;
  return colorCapability(env);
}

function bold(text, enabled) {
  return enabled ? `\x1b[1m${text}\x1b[22m` : text;
}

function stripAnsi(s) {
  return s.replace(ANSI_RE, "");
}

// Cell width, not UTF-16 length: box-drawing and block glyphs need code-point
// counting once the color codes are removed.
function width(s) {
  return Array.from(stripAnsi(s)).length;
}

function truncate(s, w) {
  const chars = Array.from(stripAnsi(s));
  if (chars.length <= w) return s;
  return chars.slice(0, Math.max(1, w - 1)).join("") + "…";
}

// Center art in a fixed cell so swapping mascot frames never nudges the panel.
function center(s, w) {
  const chars = Array.from(s);
  const pad = Math.max(0, w - chars.length);
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + s + " ".repeat(pad - left);
}

function pad(s, w) {
  const gap = w - width(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/* ---- numbers (ported) ---- */
const fmt = (v, d = 0) => v == null ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const gb = (bytes, d = 1) => bytes == null ? "–" : fmt(bytes / 1073741824, d);
const kfmt = (n) => n == null ? "–" : Number(n).toLocaleString();
const ctxfmt = (n) => n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);
const time = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// Newest value at the right, like the widget's SVG sparkline. Fewer samples than
// cells are anchored to the right edge, so a warm-up run still reads.
function spark(values, { cells = 12, max, ascii = false } = {}) {
  const v = (values || []).map((x) => (x == null ? 0 : Number(x)));
  if (!v.length) return " ".repeat(cells);
  const top = Math.max(max || 0, ...v, 1);
  const take = v.slice(-cells);
  const scale = ascii ? ASCII_SPARK : BLOCKS;
  const bars = take.map((x) => {
    const i = Math.min(scale.length - 1, Math.floor((x / top) * scale.length));
    // Index 0 of the ASCII scale is reserved for blank, so a nonzero sample
    // never lands on the empty cell.
    return scale[ascii ? Math.max(x > 0 ? 1 : 0, i) : i];
  });
  return " ".repeat(cells - bars.length) + bars.join("");
}

function bar(frac, { cells = 20, fill = "█", empty = "░", ascii = false } = {}) {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
  if (ascii) {
    // A bracketed gauge: █ and ░ collapse into each other on a framebuffer
    // without the half-block glyph, so the filled/unfilled split has to come
    // from different characters. Brackets mark the ends, which keeps the width
    // exact and the ratio obvious at a glance.
    if (cells >= 3) {
      const filled = Math.round(f * (cells - 2));
      return `[${"#".repeat(filled)}${"-".repeat(cells - 2 - filled)}]`;
    }
    return (f > 0 ? "#" : "-").repeat(Math.max(0, cells));
  }
  const n = Math.round(f * cells);
  return fill.repeat(n) + empty.repeat(cells - n);
}

/* ---- ASCII glyph fallback ---- */
// Terminals without UTF-8 (LANG=C over ssh, PuTTY's raw transport, TERM=dumb,
// the kernel console) render box-drawing and block glyphs as mojibake — the
// "all black screen" report. Every substitution is exactly one cell wide, so
// width()/truncate() math is identical before and after asciiize().
const ASCII_GLYPHS = [
  [/╭|╮|╰|╯/g, "+"], [/─/g, "-"], [/│/g, "|"], [/╱/g, "/"], [/╲/g, "\\"],
  [/▸/g, ">"], [/●/g, "*"], [/·/g, "."], [/–/g, "-"], [/…/g, "~"],
  [/°C/g, "C "], [/°/g, " "], [/×/g, "x"], [/↑/g, "^"], [/↓/g, "v"],
  [/░/g, "-"], [/▁/g, " "], [/▂/g, "."], [/▃/g, "-"], [/▄/g, "="],
  [/▅/g, "+"], [/▆/g, "*"], [/▇/g, "*"], [/█/g, "#"],
  [/◕/g, "o"], [/◡/g, "u"], [/‿/g, "u"], [/✕/g, "x"], [/﹏/g, "v"],
  [/✳|✷|✶|✴|✹/g, "*"],
];

function asciiize(s) {
  for (const [re, c] of ASCII_GLYPHS) s = s.replace(re, c);
  return s;
}

// True when the terminal should get plain ASCII. Explicit flags and
// STRATA_ASCII win; otherwise locale and TERM decide: no UTF-8 locale means
// UTF-8 bytes arrive as mojibake, and TERM=dumb/unknown or the kernel console
// (TERM=linux, whose default cp437 font has no half-blocks) cannot draw them
// either way.
function asciiMode(flag, env = process.env) {
  if (flag === true || flag === "ascii") return true;
  if (flag === false || flag === "utf8") return false;
  // An explicit STRATA_ASCII decides outright, in both directions: a locale
  // that is simply unset (cron, a bare docker run) must not force ASCII on a
  // terminal that renders UTF-8 just fine, and STRATA_ASCII=0 is how that user
  // says so.
  const envFlag = String(env.STRATA_ASCII ?? "");
  if (envFlag !== "") return !/^(0|false|no|off)$/i.test(envFlag);
  if (/dumb|unknown/i.test(String(env.TERM || "")) || /^linux$/i.test(String(env.TERM || ""))) return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || "";
  return !/utf-?8/i.test(locale);
}

module.exports = {
  PALETTES, STATE_ROLE, paint, bold, stripAnsi, width, truncate, center, pad,
  ANSI_BY_ROLE, COLOR_MODES, colorCapability, colorMode,
  fmt, gb, kfmt, ctxfmt, time, spark, bar, BLOCKS, ASCII_SPARK,
  asciiize, asciiMode,
};
