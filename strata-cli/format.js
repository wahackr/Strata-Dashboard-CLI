// Number formatting, sparklines, bars and color. The number helpers are ported
// from renderer/renderer.js so the terminal and the widget say the same thing
// about the same payload.
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

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

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Colors are 24-bit, applied only when the caller says the terminal can take
// them; with color off, paint() is the identity and widths stay exact.
function paint(text, hex, enabled) {
  if (!enabled || !hex) return text;
  const [r, g, b] = hexToRgb(hex);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
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
function spark(values, { cells = 12, max } = {}) {
  const v = (values || []).map((x) => (x == null ? 0 : Number(x)));
  if (!v.length) return " ".repeat(cells);
  const top = Math.max(max || 0, ...v, 1);
  const take = v.slice(-cells);
  const bars = take.map((x) => BLOCKS[Math.min(BLOCKS.length - 1, Math.floor((x / top) * BLOCKS.length))]);
  return " ".repeat(cells - bars.length) + bars.join("");
}

function bar(frac, { cells = 20, fill = "█", empty = "░" } = {}) {
  const f = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0));
  const n = Math.round(f * cells);
  return fill.repeat(n) + empty.repeat(cells - n);
}

function spinner(tick) {
  return SPINNER[tick % SPINNER.length];
}

module.exports = {
  PALETTES, STATE_ROLE, paint, bold, stripAnsi, width, truncate, center, pad,
  fmt, gb, kfmt, ctxfmt, time, spark, bar, spinner, BLOCKS, SPINNER,
};
