// Rendering: derived values against the widget's saved fixture, geometry that
// never overflows the terminal, and mascot frames that never change size.
// Run: node test/render.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const f = require("../strata-cli/format.js");
const mascot = require("../strata-cli/mascot.js");
const { derive } = require("../strata-cli/derive.js");
const { render } = require("../strata-cli/render.js");
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
assert.equal(derive({ ok: false, status: 0 }).detail, "connect ECONNREFUSED");
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

// ---- mascot frames never change size ----
for (const state of mascot.stateList()) {
  for (const tick of [0, 1, 2, 3, 4, 7]) {
    const rows = mascot.frame(state, tick);
    assert.equal(rows.length, mascot.H, `${state} frame height is fixed`);
    for (const row of rows) assert.equal(f.width(row), mascot.W, `${state} frame width is fixed`);
  }
}
assert.ok(mascot.frame("nonsense-state", 0).length === mascot.H, "unknown state falls back to idle");

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

// Compact mode: exactly one line per server between header and help.
const compact = render({ entries, width, height: 40, theme: "dark", color: false, compact: true, tick: 1 });
assert.equal(compact.length, entries.length + 2, "compact strip is one line per server");
for (const line of compact) assert.ok(f.width(line) <= width, `compact line fits: ${JSON.stringify(line)}`);

// Too tall for the screen: the panels collapse to strips instead of scrolling.
const tall = render({ entries, width, height: 12, theme: "dark", color: false, tick: 0 });
assert.equal(tall.length, entries.length + 2, "auto-compact when the panels would overflow");

// Color on must not change the geometry.
const colored = render({ entries, width, height: 40, theme: "light", color: true, tick: 2 });
assert.equal(colored.length, lines.length, "color does not add or remove lines");
for (let i = 0; i < colored.length; i++) {
  assert.equal(f.width(colored[i]), f.width(lines[i]), `line ${i} keeps its width with color on`);
}

// A narrow terminal still renders (min inner width is enforced, not crashed).
const narrow = render({ entries, width: 40, height: 40, theme: "dark", color: false, compact: true, tick: 0 });
assert.ok(narrow.length > 0 && narrow.every((l) => f.width(l) <= 48), "narrow terminal clamps gracefully");

console.log("derived metrics, sparkline and bar geometry, mascot frames, and full/compact layout OK");
