// Rendering: derived values against the widget's saved fixture, geometry that
// never overflows the terminal, and mascot frames that never change size.
// Run: node test/render.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const f = require("../strata-cli/format.js");
const mascot = require("../strata-cli/mascot.js");
const { derive } = require("../strata-cli/derive.js");
const { render, panelRows, shortGpuName, PANEL_ROWS } = require("../strata-cli/render.js");
const { stateOf } = require("../strata-cli/client.js");

const metrics = JSON.parse(fs.readFileSync(path.join(__dirname, "metrics.json"), "utf8"));
const ok = (m) => ({ ok: true, status: 200, metrics: m, health: { model: "qwen3.8-flash-next" }, latencyMs: 12 });

// ---- state precedence, same as main.js trayStateFor ----
assert.equal(stateOf(ok(metrics)), stateOf({ ok: true, metrics: { live: metrics.live } }));
assert.equal(stateOf(ok({ live: { state: "generating", queued: 2 } })), "queued", "queued outranks live state");
assert.equal(stateOf(ok({ live: { state: "idle" } })), "idle");
assert.equal(stateOf({ ok: false, status: 503 }), "error");

// ---- derived numbers ----
const d = derive(ok(metrics));
assert.equal(d.model, "qwen3.8-flash-next", "health.model wins over engine.model");
assert.notEqual(d.gpu, null, "gpu load read from the fixture");
assert.notEqual(d.vramUsed, null, "vram read");
assert.ok(d.ctxMax > 0, "max_context read");
assert.ok(d.ctxFrac >= 0 && d.ctxFrac <= 1, "context fraction clamped into 0..1");
assert.ok(d.cache.includes("experts"), "expert cache line built");
assert.ok(d.lastRequest.length > 0, "last request summarized");

// Context fill matches the widget's own checked case: half of 131072 -> 50%.
const half = derive(ok({ live: { state: "generating", prompt_tokens: 65536, generated: 0 }, engine: { max_context: 131072 } }));
assert.equal(Math.round(half.ctxFrac * 100), 50, "context fill ring maths matches the widget's smoke test");

// Reading progress.
const reading = derive(ok({ live: { state: "reading", prompt_read: 4000, prompt_total: 8000 } }));
assert.equal(reading.label, "Reading prompt");
assert.equal(Math.round(reading.pct), 50);
// Built from kfmt rather than a literal "4,000": digit grouping follows the
// locale, and this test has to pass the same way in every one.
assert.ok(reading.detail.includes(`${f.kfmt(4000)} / ${f.kfmt(8000)} tokens`), "read/total tokens rendered");

// Failure paths, mirroring renderer.js renderFailure().
assert.equal(derive({ ok: false, status: 401, error: "401 unauthorized" }).label, "API key needed");
assert.equal(derive({ ok: false, status: 0, error: "connect ECONNREFUSED" }).label, "Server not reachable");
assert.equal(derive({ ok: false, status: 0, error: "connect ECONNREFUSED" }).detail,
  "connect ECONNREFUSED", "transport error is shown as the failure detail");
assert.equal(derive(null).label, "Connecting…", "no poll yet is not an error");
const empty = derive(ok({ live: { state: "idle" }, hardware: {}, hardware_static: {}, engine: {}, history: {}, requests: [] }));
assert.equal(empty.gpu, null, "missing hardware renders as a dash, not a crash");

// ---- geometry helpers ----
assert.equal(f.spark([1, 2, 3, 4], { cells: 8 }).length, 8, "spark pads to the cell count");
assert.equal(f.spark(Array.from({ length: 40 }, (_, i) => i), { cells: 12 }).length, 12);
assert.equal(f.spark([], { cells: 6 }), "      ", "no history is blank, not an error");
assert.ok(f.spark([0, 0, 0], { cells: 3 }).endsWith(f.BLOCKS[0]), "zero values still draw the lowest block");
assert.equal(f.bar(0.5, { cells: 20 }).length, 20);
assert.equal(f.bar(1.5, { cells: 10 }), "█".repeat(10), "over-1 fractions clamp");
assert.equal(f.bar(NaN, { cells: 10 }), "░".repeat(10), "NaN draws empty");
assert.equal(f.width(f.paint("abc", "#b8f36b", true)), 3, "color codes are not counted as cells");

// ---- ASCII gauges and sparklines ----
// On a framebuffer with no block glyphs, █ and ░ collapse into the same box or
// into mojibake, so the filled/unfilled split has to come from different
// characters. A bracketed gauge stays legible in cp437 and keeps its width.
assert.match(f.bar(0.5, { cells: 20, ascii: true }), /^\[#+-*\]$/, "ascii gauge is brackets, hashes and dashes");
for (const cells of [3, 7, 20, 30, 59]) {
  for (const frac of [0, 0.25, 0.5, 0.75, 1, 1.5, NaN]) {
    assert.equal(f.width(f.bar(frac, { cells, ascii: true })), cells, `ascii gauge keeps ${cells} cells at ${frac}`);
  }
}
assert.equal(f.bar(0, { cells: 10, ascii: true }), "[" + "-".repeat(8) + "]", "an empty gauge still shows the ends");
assert.equal(f.bar(1, { cells: 10, ascii: true }), "[" + "#".repeat(8) + "]", "a full gauge is all hashes");
assert.equal(f.bar(0.5, { cells: 3, ascii: true }), "[#]", "a 3-cell gauge has room for one hash");
assert.equal(f.bar(0.5, { cells: 2, ascii: true }), "##", "below 3 cells there is no room for brackets");
assert.ok(!f.bar(0.5, { cells: 20, ascii: true }).includes("@"), "no @ in the ascii gauge");
// The ASCII scale is ordered quiet to loud, and index 0 is blank rather than a
// comma sitting on a baseline: a zero run reads as empty, and a nonzero sample
// never lands on the empty cell.
assert.equal(f.spark([0, 0, 0], { cells: 3, ascii: true }), "   ", "all-zero ascii history is blank");
assert.ok(!f.spark([0, 1, 2, 4, 8], { cells: 5, ascii: true }).includes(","), "the ascii scale has no comma");
assert.equal(f.spark([0, 1, 2, 4, 8], { cells: 5, ascii: true }), " ..=#", "ascii intensity rises with the value");
assert.ok(f.spark([1, 2, 3, 4], { cells: 8, ascii: true }).startsWith(" "), "ascii spark still right-anchors a warm-up");
for (const cells of [4, 10, 12]) {
  const s = f.spark([3, 6, 9], { cells, ascii: true });
  assert.equal(f.width(s), cells, `ascii spark keeps ${cells} cells`);
  assert.ok(!/[^\x00-\x7F]/.test(s), "the ascii scale is pure ASCII");
  assert.ok(!/^ +$/.test(s), "a nonzero ascii spark is not all blank");
}

// ---- color depth: the accent is green on a plain terminal, never yellow ----
// Quantizing #b8f36b by nearest neighbour lands on yellow (hue ~86°), which is
// exactly the bug on Alpine's tty / TERM=linux, so the codes are by meaning.
assert.equal(f.paint("tok", "#b8f36b", "16"), "\x1b[92mtok\x1b[39m", "dark accent is bright green at 16 colors");
assert.equal(f.paint("tok", "#b8f36b", "256"), "\x1b[38;5;10mtok\x1b[39m", "dark accent is bright green at 256 colors");
assert.equal(f.paint("tok", "#3f7d16", "16"), "\x1b[32mtok\x1b[39m", "light accent is green at 16 colors");
assert.ok(!f.paint("tok", "#b8f36b", "16").includes("38;2;"), "16-color mode emits no 24-bit codes");
assert.equal(f.paint("tok", "#b8f36b", false), "tok", "off is the identity");
assert.equal(f.width(f.paint("tok", "#b8f36b", "16")), 3, "named codes are stripped for width too");
// Every escape paint() emits has to be a foreground verb. A bare SGR number is
// a different verb: 8 conceals, 10 sets the background, 15 is not a color at
// all — and paint() closes with 39, which resets only the foreground, so a
// concealed frame never un-conceals. That is what made the screen look empty on
// a TERM=*256color terminal with no COLORTERM.
const FOREGROUND = /^\x1b\[(3[0-7]|9[0-7]|38;(5|2);[\d;]+|22|39)m$/;
for (const theme of Object.keys(f.PALETTES)) {
  for (const [role, hex] of Object.entries(f.PALETTES[theme])) {
    assert.match(f.paint("x", hex, "16"), /^\x1b\[\d+m/, `${theme}.${role} has a named color for plain terminals`);
    for (const mode of ["16", "256", "truecolor", "console"]) {
      for (const code of f.paint("x", hex, mode).match(/\x1b\[[0-9;]*m/g)) {
        assert.ok(FOREGROUND.test(code), `${theme}.${role} at ${mode} paints ${JSON.stringify(code)}, not a foreground`);
      }
    }
  }
}

// Auto-detection: only COLORTERM says 38;2 is understood, and the kernel
// console overrides even that.
assert.equal(f.colorMode(undefined, { TERM: "linux" }, true), "console", "TERM=linux gets the console palette");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color" }, true), "256");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color", COLORTERM: "truecolor" }, true), "truecolor");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color", NO_COLOR: "1" }, true), false, "NO_COLOR wins");
assert.equal(f.colorMode(true, { TERM: "linux", NO_COLOR: "1" }, true), "console", "an explicit --color still colors");
// The reported bug: a shell profile or a tmux session elsewhere exports
// COLORTERM=truecolor, and vconsole honors TERM=linux, not that. Describing a
// different terminal is worse than describing this one, so TERM=linux wins.
assert.equal(f.colorMode(undefined, { TERM: "linux", COLORTERM: "truecolor" }, true), "console",
  "an inherited COLORTERM does not override the kernel console");
assert.equal(f.colorCapability({ TERM: "linux", COLORTERM: "truecolor" }), "console", "capability agrees with colorMode");
assert.equal(f.colorCapability({ TERM: "LINUX" }), "console", "TERM is matched case-insensitively");
assert.equal(f.colorMode("truecolor", { TERM: "linux" }, true), "truecolor", "--color truecolor still overrides TERM=linux");
assert.equal(f.colorMode("16", { TERM: "linux" }, true), "16", "--color 16 overrides TERM=linux");
assert.equal(f.colorMode("console", { TERM: "xterm-256color" }, true), "console", "--color console works anywhere");
assert.equal(f.colorMode("console", { TERM: "xterm-256color" }, false), "console", "--color console colors a pipe");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color" }, false), false, "a pipe stays plain");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color", FORCE_COLOR: "1" }, false), "256", "FORCE_COLOR colors a pipe");
assert.equal(f.colorMode(undefined, { TERM: "xterm-256color", FORCE_COLOR: "0" }, true), false);
assert.equal(f.colorMode(false, { COLORTERM: "truecolor" }, true), false, "--no-color wins over the terminal");
assert.equal(f.colorMode("never", { TERM: "xterm-256color" }, true), false);
assert.equal(f.colorMode("256", { TERM: "linux" }, true), "256", "--color 256 overrides TERM");
assert.equal(f.colorMode("auto", { TERM: "linux" }, true), "console", "--color auto is the default behavior");

// ---- the console palette ----
// 8 foreground colors on a black framebuffer: bright black (90) is barely
// visible, which is what made muted text and the box look like empty space on
// an Arch vconsole. The low-contrast roles get a real color; the status colors
// keep their 91/92/93 so good/warn/bad still mean the same thing.
assert.equal(f.paint("tok", f.PALETTES.dark.muted, "console"), "\x1b[37mtok\x1b[39m", "dark muted is white on the console");
assert.equal(f.paint("box", f.PALETTES.dark.border, "console"), "\x1b[36mbox\x1b[39m", "dark border is cyan on the console");
assert.equal(f.paint("tok", f.PALETTES.dark.accent, "console"), "\x1b[92mtok\x1b[39m", "dark accent stays green");
assert.equal(f.paint("tok", f.PALETTES.dark.good, "console"), "\x1b[92mtok\x1b[39m", "generating stays green");
assert.equal(f.paint("tok", f.PALETTES.dark.warn, "console"), "\x1b[93mtok\x1b[39m", "queued stays yellow");
assert.equal(f.paint("tok", f.PALETTES.dark.bad, "console"), "\x1b[91mtok\x1b[39m", "error stays red");
assert.equal(f.paint("tok", f.PALETTES.light.muted, "console"), "\x1b[90mtok\x1b[39m", "the light theme is untouched");
assert.ok(!f.paint("tok", f.PALETTES.dark.muted, "console").includes("38;"), "console mode emits no indexed or 24-bit codes");
assert.ok(!f.paint("tok", f.PALETTES.dark.border, "console").includes("38;"), "console borders stay plain codes");
// The bump must never reach the roles that already read well, and must not
// invent a code for a theme that has no console entry.
for (const [role, hex] of Object.entries(f.PALETTES.dark)) {
  assert.match(f.paint("x", hex, "console"), /^\x1b\[(3[0-7]|9[0-7])m/, `dark.${role} has a plain console foreground`);
}

// ---- mascot frames never change size ----
for (const state of mascot.stateList()) {
  for (const tick of Array.from({ length: 32 }, (_, i) => i)) {
    const rows = mascot.frame(state, tick);
    assert.equal(rows.length, mascot.H, `${state} frame height is fixed`);
    for (const row of rows) assert.equal(f.width(row), mascot.W, `${state} frame width is fixed`);
  }
}
assert.ok(mascot.frame("nonsense-state", 0).length === mascot.H, "unknown state falls back to idle");

// The bunny stays ASCII in both terminal modes, with identical geometry.
for (const state of mascot.stateList()) {
  for (const tick of Array.from({ length: 32 }, (_, i) => i)) {
    const rows = mascot.frame(state, tick, true);
    assert.equal(rows.length, mascot.H, `${state} ascii frame height is fixed`);
    for (const row of rows) {
      assert.equal(f.width(row), mascot.W, `${state} ascii frame width is fixed`);
      assert.ok(!/[^\x00-\x7F]/.test(row), `${state} ascii frame row is pure ASCII: ${JSON.stringify(row)}`);
    }
    const uni = mascot.frame(state, tick);
    uni.forEach((row, i) => assert.equal(f.width(rows[i]), f.width(row), `${state} tick ${tick}: ascii row ${i} matches the unicode row`));
  }
}
assert.ok(!mascot.stateList().some((s) => mascot.frame(s, 0, true).join("").includes("@")), "the ascii mascot has no @");
// The face has to be readable, not a row of identical characters: the eyes are
// two separated marks; each state has its own eyes and accessory.
for (const state of mascot.stateList()) {
  const eyes = mascot.ASCII_FACE[state].eyes;
  assert.equal(eyes.length, 5, "ascii eyes keep the unicode 5-cell width");
  assert.ok(!/^(\S)\1+$/.test(eyes), `${state} ascii eyes are two marks, not a solid bar`);
}
// Preserve the approved rounded silhouette and keep the mouth above the chin.
assert.deepEqual(mascot.frame("generating", 0).slice(1).map((row) => row.trimEnd()), [
  "    _   _", "   | | | |", "   | |_| |", "  /       \\",
  " |  .   .  |", " |    x    |", "  \\_______/",
]);
assert.equal(new Set(mascot.stateList().map((s) => mascot.frame(s, 0).join("\n"))).size,
  mascot.stateList().length, "all server states look distinct without color");
const idleCycle = Array.from({ length: 16 }, (_, tick) => mascot.frame("idle", tick));
assert.ok(idleCycle[0][5].includes("-   -"), "idle starts with sleepy eyes");
assert.ok(idleCycle[15][5].includes(".   ."), "idle occasionally opens its eyes");
assert.ok(idleCycle[4][0].indexOf("z") < idleCycle[8][0].indexOf("z")
  && idleCycle[8][0].indexOf("z") < idleCycle[12][0].indexOf("z"), "idle z drifts right");
for (const rows of idleCycle) {
  for (const i of [1, 2, 3, 4, 6, 7]) {
    assert.equal(rows[i], idleCycle[0][i], "ears, outline, mouth and chin stay stable while idling");
  }
}
assert.ok(!/[^\x00-\x7F]/.test(mascot.inline("generating", true)), "the compact inline face is ascii");
assert.equal(f.width(mascot.inline("generating", true)), f.width(mascot.inline("generating")), "ascii inline face keeps its width");

// ---- whole-frame layout ----
const servers = [
  { id: "srv-1", name: "Home", url: "http://127.0.0.1:8080", apiKey: "k", keySource: "config", refreshMs: 1000, timeoutMs: 4000 },
  { id: "srv-2", name: "Office", url: "http://192.168.1.20:8080", apiKey: "", keySource: "none", refreshMs: 2000, timeoutMs: 4000 },
];
const entries = [
  { server: servers[0], payload: ok(metrics) },
  { server: servers[1], payload: { ok: false, status: 0, error: "timeout" } },
];
const width = 100;
const lines = render({ entries, width, height: 40, theme: "dark", color: false, mascot: true, tick: 3 });
for (const line of lines) assert.ok(f.width(line) <= width, `line fits the terminal: ${JSON.stringify(line)}`);
assert.ok(lines.some((l) => l.includes("Home")), "server name drawn");
assert.ok(lines.some((l) => l.includes("Office")), "second server drawn");
assert.ok(lines.some((l) => l.includes("Server not reachable")), "offline server reported");
assert.ok(lines.some((l) => l.includes("● generating") || l.includes("● idle") || l.includes("● reading")), "state tag drawn");
assert.ok(lines.some((l) => l.includes("Ctx")), "context card drawn");
assert.ok(lines.some((l) => l.includes("Strata CLI")), "header drawn");
// The blank-screen report was 256-color mode emitting bare palette indices,
// which are conceal (8) and background (10) rather than foreground colors.
const painted = render({ entries, width, height: 40, theme: "dark", color: "256", mascot: true, tick: 3 });
assert.ok(painted.every((l) => !/\x1b\[(8|10|11|15)m/.test(l)), "a 256-color frame conceals nothing");
assert.ok(painted.some((l) => l.includes("\x1b[38;5;")), "the 256-color frame paints indexed foregrounds");
assert.equal(painted.length, lines.length, "color changes no geometry");
painted.forEach((l, i) => assert.equal(f.width(l), f.width(lines[i]), `painted row ${i} keeps its cell count`));

// Compact mode: exactly one line per server between header and help.
const compact = render({ entries, width, height: 40, theme: "dark", color: false, compact: true, tick: 1 });
assert.equal(compact.length, entries.length + 2, "compact strip is one line per server");
for (const line of compact) assert.ok(f.width(line) <= width, `compact line fits: ${JSON.stringify(line)}`);

// ---- ASCII fallback ----
// A terminal without UTF-8 gets the same frame in ASCII twins. Each glyph maps
// to exactly one cell, so the geometry is unchanged and nothing above U+007F
// survives to be drawn as mojibake — the "all black screen" report.
const asciiFrame = render({ entries, width, height: 40, theme: "dark", color: false, ascii: true, mascot: true, tick: 3 });
assert.equal(asciiFrame.length, lines.length, "ascii frame keeps the same shape");
asciiFrame.forEach((l, i) => assert.equal(f.width(l), f.width(lines[i]), `ascii row ${i} keeps its cell count`));
assert.ok(asciiFrame.every((l) => !/[^\x00-\x7F]/.test(l)), "every glyph has an ASCII twin");
const asciiStrip = render({ entries, width, height: 40, theme: "dark", color: false, ascii: true, compact: true, tick: 1 });
assert.ok(asciiStrip.every((l) => !/[^\x00-\x7F]/.test(l)), "the compact strip is ascii too");
// The gauges are the readability fix itself: brackets and hashes, no @, and
// the filled/unfilled split obvious even when the font has no half-blocks.
assert.ok(asciiFrame.some((l) => /\[[#+-]*\]/.test(l)), "ascii frame draws bracket gauges");
assert.ok(!asciiFrame.join("\n").includes("@"), "no @ anywhere in the ascii frame");
assert.ok(asciiFrame.some((l) => /\[\#+-+\]/.test(l)), "a gauge shows both filled and unfilled cells");

// Same frame, console palette: color must not move a single cell, and no code
// may conceal or set a background (the original blank-screen failure).
for (const w of [40, 60, 80, 100]) {
  const plain = render({ entries, width: w, height: 40, theme: "dark", color: false, ascii: true, mascot: true, tick: 3 });
  const consoleFrame = render({ entries, width: w, height: 40, theme: "dark", color: "console", ascii: true, mascot: true, tick: 3 });
  assert.equal(consoleFrame.length, plain.length, `console palette keeps the row count at width ${w}`);
  consoleFrame.forEach((l, i) => assert.equal(f.width(l), f.width(plain[i]), `console row ${i} keeps its cell count at width ${w}`));
  assert.ok(consoleFrame.every((l) => !/\x1b\[(8|10|11|15)m/.test(l)), `console frame conceals nothing at width ${w}`);
  assert.ok(consoleFrame.some((l) => l.includes("\x1b[37m")), `console frame brightens muted text at width ${w}`);
  assert.ok(consoleFrame.some((l) => l.includes("\x1b[36m")), `console frame paints the border at width ${w}`);
}

assert.equal(f.asciiMode(true, {}), true, "--ascii beats the environment");
assert.equal(f.asciiMode(false, { TERM: "dumb" }), false, "--no-ascii beats the environment");
assert.equal(f.asciiMode(undefined, { LANG: "en_US.UTF-8", TERM: "xterm-256color" }), false, "a UTF-8 terminal keeps the glyphs");
assert.equal(f.asciiMode(undefined, { LANG: "C", TERM: "xterm-256color" }), true, "LANG=C falls back to ascii");
assert.equal(f.asciiMode(undefined, { LANG: "en_US.UTF-8", TERM: "linux" }), true, "the kernel console falls back");
assert.equal(f.asciiMode(undefined, { LANG: "C", STRATA_ASCII: "0" }), false, "STRATA_ASCII=0 opts out of ascii");
assert.equal(f.asciiMode(undefined, { LANG: "en_US.UTF-8", STRATA_ASCII: "1" }), true, "STRATA_ASCII=1 opts in");

// Regression: switching to compact crashed on a generating server because
// derive() returns speed as a number and pad() counts cells on a string.
const busy = [{
  server: servers[0], focused: true,
  payload: ok({ live: { state: "generating", tok_s: 41.200000000000004, generated: 12, max_tokens: 200 },
    engine: { max_context: 131072 }, history: { tok_s: [1, 2, 3] } }),
}];
const busyStrip = render({ entries: busy, width, height: 40, theme: "dark", color: false, compact: true, tick: 0 });
// The speed sits in a 5-cell column, so pad() leaves trailing blanks before "t/s".
assert.ok(busyStrip.some((l) => /41\.2\s+t\/s/.test(l)), "compact strip renders the decode speed");
assert.ok(!busyStrip.join("\n").includes("41.200000000000004"), "float noise is rounded away");
const busyPanel = render({ entries: busy, width, height: 40, theme: "dark", color: false, tick: 0 });
assert.ok(busyPanel.some((l) => /Speed\s+41\.2/.test(l)), "expanded panel rounds the decode speed");

// Too tall for the screen: the panels collapse to strips instead of scrolling.
const tall = render({ entries, width, height: 12, theme: "dark", color: false, tick: 0 });
assert.equal(tall.length, entries.length + 2, "auto-compact when the panels would overflow");

// Color on must not change the geometry. Same theme on both sides: the header
// prints the theme name, so "light" is a cell wider than "dark" by design.
const colored = render({ entries, width, height: 40, theme: "dark", color: true, tick: 2 });
assert.equal(colored.length, lines.length, "color does not add or remove lines");
for (let i = 0; i < colored.length; i++) {
  assert.equal(f.width(colored[i]), f.width(lines[i]), `line ${i} keeps its width with color on`);
}

// A narrow terminal still renders (min inner width is enforced, not crashed).
const narrow = render({ entries, width: 40, height: 40, theme: "dark", color: false, compact: true, tick: 0 });
assert.ok(narrow.length > 0 && narrow.every((l) => f.width(l) <= 48), "narrow terminal clamps gracefully");

// ---- multi-GPU (issue #4) ----
// Mirrors the verified live payload: Tesla P40 + RTX 4070, aggregate fields
// present, no per-GPU PCIe yet.
const multi = {
  live: { state: "idle" },
  engine: { max_context: 131072 },
  hardware: {
    gpu_util: 0, gpu_mem_used: 35887251456, gpu_mem_total: 37037801472,
    gpu_temp: 52, gpu_power: 85.94, gpu_power_limit: 450,
    gpu_pcie_gen: 3, gpu_pcie_gen_max: 3, gpu_pcie_width: 16,
    gpu_pcie_rx_mb: 0.285, cpu: 12, disk_read_mb: 41.2,
    gpus: [
      { index: 0, name: "Tesla P40", util: 0, mem_used: 23487971328, mem_total: 24159191040, temp: 52, power: 56.547 },
      { index: 1, name: "NVIDIA GeForce RTX 4070", util: 0, mem_used: 12399280128, mem_total: 12878610432, temp: 41, power: 29.391 },
    ],
  },
  hardware_static: { gpu_count: 2 },
  history: { gpu_util: [0, 0], tok_s: [] },
  requests: [],
};
const md = derive(ok(multi));
assert.equal(md.gpus.length, 2, "per-GPU breakdown derived when more than one GPU");
assert.equal(md.gpus[0].name, "Tesla P40");
assert.equal(md.gpus[1].memTotal, 12878610432, "per-GPU mem_total read");
assert.equal(shortGpuName("NVIDIA GeForce RTX 4070"), "RTX 4070", "vendor prefix trimmed");
assert.equal(shortGpuName("Tesla P40"), "Tesla P40", "short names kept");
assert.equal(derive(ok({ hardware: { gpus: [{ index: 0, name: "A", util: 5 }] } })).gpus.length, 0,
  "one GPU stays on the consolidated cards");

const gpuEntries = [{ server: servers[0], payload: ok(multi) }];
const gpuPanel = render({ entries: gpuEntries, width: 100, height: 40, theme: "dark", color: false, tick: 0 });
assert.ok(gpuPanel.some((l) => l.includes("GPU 0") && l.includes("Tesla P40")), "GPU 0 row drawn");
assert.ok(gpuPanel.some((l) => l.includes("GPU 1") && l.includes("RTX 4070")), "GPU 1 row drawn with short name");
assert.ok(!gpuPanel.some((l) => l.includes(" VRAM")), "consolidated VRAM card replaced by rows");
assert.ok(!gpuPanel.some((l) => l.includes(" Temp")), "consolidated Temp card replaced by rows");
assert.ok(gpuPanel.some((l) => l.includes("PCIe")), "PCIe card kept (server-wide in this payload)");
for (const line of gpuPanel) assert.ok(f.width(line) <= 100, `multi-GPU line fits: ${JSON.stringify(line)}`);
// The util bar must not eat the value tail: power and per-slot PCIe have to
// survive at common widths, not truncate away.
assert.ok(gpuPanel.some((l) => l.includes("57 W")) && gpuPanel.some((l) => l.includes("29 W")), "per-GPU power drawn in full");
const withPcie = ok({ ...multi, hardware: { ...multi.hardware,
  gpus: multi.hardware.gpus.map((g) => ({ ...g, pcie_gen: 4, pcie_width: g.index === 0 ? 16 : 8 })) } });
const pciePanel = render({ entries: [{ server: servers[0], payload: withPcie }], width: 100, height: 40, theme: "dark", color: false, tick: 0 });
assert.ok(pciePanel.some((l) => l.includes("Gen4 x16")), "per-GPU PCIe renders when the payload carries it");
assert.ok(pciePanel.some((l) => l.includes("Gen4 x8")), "second GPU gets its own PCIe slot");
assert.ok(pciePanel.every((l) => f.width(l) <= 100), "per-GPU PCIe lines still fit");
assert.equal(panelRows(ok(multi)), 18, "2-GPU panel is 16 + N rows");
assert.equal(gpuPanel.length, panelRows(ok(multi)) + 2, "drawn frame = header + panel + help");
assert.equal(panelRows(ok(metrics)), PANEL_ROWS, "single-GPU panel keeps PANEL_ROWS");

// The taller panel collapses earlier: 3 GPUs needs 19 rows + header + help.
const three = ok({ ...multi, hardware: { ...multi.hardware,
  gpus: multi.hardware.gpus.concat({ index: 2, name: "Tesla P100", util: null, mem_used: null, mem_total: null, temp: null, power: null }) } });
assert.equal(panelRows(three), 19, "3-GPU panel height");
const tight = render({ entries: [{ server: servers[0], payload: three }, { server: servers[1], payload: three }],
  width: 100, height: 17, theme: "dark", color: false, tick: 0 });
assert.equal(tight.length, 4, "auto-compact when the GPU rows would overflow");
const threePanel = render({ entries: [{ server: servers[0], payload: three }], width: 100, height: 40, theme: "dark", color: false, tick: 0 });
assert.ok(threePanel.some((l) => l.includes("GPU 2") && l.includes("–")), "missing per-GPU fields render as dashes");

// Check the exact screen-fit boundary, including a single server and warnings.
for (const payload of [ok(metrics), ok(multi), three]) {
  for (const mascotOn of [true, false]) {
    const one = [{ server: servers[0], payload }];
    const expected = panelRows(payload, mascotOn) + 2;
    const options = { entries: one, width: 80, color: false, mascot: mascotOn };
    const expanded = render({ ...options, height: expected });
    assert.equal(expanded.length, expected, "panel fits at the exact height boundary");
    assert.ok(expanded.some((l) => l.startsWith("╭")), "boundary retains expanded panel");
    assert.ok(expanded.every((l) => f.width(l) === 80 || !l.startsWith("│")), "panel borders stay aligned");
    assert.ok(!expanded.join("\n").includes("undefined"), "extra mascot rows have empty status text");
    const smaller = render({ ...options, height: expected - 1 });
    assert.equal(smaller.length, 3, "one server compacts when its panel is too tall");
    const warned = render({ ...options, height: expected, warnings: ["example warning"] });
    assert.equal(warned.length, 4, "warnings count toward screen height");
    assert.equal(expanded.some((l) => l.includes("| |_| |")), mascotOn, "mascot toggle controls the bunny");
  }
}
assert.equal(panelRows(ok(metrics), false), 15, "hiding the bunny restores the smaller panel");

// Compact strip carries the GPU count badge.
const gpuStrip = render({ entries: gpuEntries, width: 100, height: 40, theme: "dark", color: false, compact: true, tick: 0 });
assert.ok(gpuStrip.some((l) => l.includes("GPU") && l.includes("×2")), "compact strip badges multiple GPUs");

// Full-width box: no 120-col cap.
const wide = render({ entries: gpuEntries, width: 200, height: 40, theme: "dark", color: false, tick: 0 });
assert.ok(wide.some((l) => l.startsWith("╭") && f.width(l) === 200), "box spans the screen width");
for (const line of wide) assert.ok(f.width(line) <= 200, "wide lines still fit");

// The GPU rows are the glyph-densest path — the ×N badge, the – placeholders
// for a slot with no fields, °C and the bars — so the ascii pass is checked
// against them as well as against the single-GPU frame.
for (const payload of [ok(multi), three, withPcie]) {
  const frame = render({ entries: [{ server: servers[0], payload }], width: 100, height: 40, theme: "dark", color: false, ascii: true, tick: 0 });
  assert.ok(frame.every((l) => !/[^\x00-\x7F]/.test(l)), "multi-GPU frame is fully ascii");
}
assert.ok(render({ entries: gpuEntries, width: 100, height: 40, theme: "dark", color: false, ascii: true, compact: true, tick: 0 })
  .every((l) => !/[^\x00-\x7F]/.test(l)), "the ×N badge is ascii");

console.log("derived metrics, sparkline and gauge geometry, mascot frames, multi-GPU rows, ascii fallback, console palette, and full/compact layout OK");
