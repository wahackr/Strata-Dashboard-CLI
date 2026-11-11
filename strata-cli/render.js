// Layout: polled payloads -> terminal lines. Mirrors the widget's card set
// (state card, eight metric cards, context card, last request) with box
// drawing instead of SVG. Pure, so tests can assert on strings without a TTY.
const f = require("./format.js");
const mascot = require("./mascot.js");
const { derive } = require("./derive.js");

const STATUS_ROWS = 5;
const PANEL_ROWS = 10 + mascot.H; // single-GPU panel, borders included
// Multi-GPU panels replace four metric rows with two rows plus one per GPU.
// Without the mascot, only the five status rows need space.
function panelRows(payload, mascotOn = true) {
  const n = derive(payload).gpus.length;
  const statusRows = mascotOn ? mascot.H : STATUS_ROWS;
  return statusRows + (n > 0 ? 8 + n : 10);
}

// GPU names arrive as marketing strings ("NVIDIA GeForce RTX 4070"); the row
// has room for the model, not the vendor.
function shortGpuName(name) {
  return String(name).replace(/^NVIDIA\s+GeForce\s+/i, "")
    .replace(/^NVIDIA\s+/i, "").trim() || String(name);
}

function top(label, iw, pal, color) {
  // Truncate before padding: a title longer than the box would otherwise push
  // the right border past the terminal width.
  const t = f.truncate(` ${label} `, Math.max(4, iw - 4));
  const rest = Math.max(1, iw - 3 - f.width(t));
  // The frame is painted with the border role, which is grey (90) rather than
  // the default foreground: an uncoloured box is as loud as the text inside
  // it, which is what made the ASCII fallback look noisy on a console.
  return f.paint("╭─", pal.border, color) + f.bold(t, color)
    + f.paint("─".repeat(rest) + "╮", pal.border, color);
}

function bottom(iw, pal, color) {
  return f.paint(`╰${"─".repeat(iw - 2)}╯`, pal.border, color);
}

function row(text, iw, pal, color) {
  return f.paint("│ ", pal.border, color)
    + f.truncate(f.pad(text, iw - 4), iw - 4)
    + f.paint(" │", pal.border, color);
}

function stateTag(state, pal, color) {
  return f.paint(`● ${state}`, pal[f.STATE_ROLE[state] || "muted"], color);
}

// label(6) + value(12) + spark(10) = 30 cells, so a row of two fits a 68-cell
// panel. Narrower panels shrink the cell: the spark goes first, then the value.
// Truncation happens on the pieces, never on the finished string: slicing a
// painted string would cut an ANSI code in half.
function metricCell(label, value, unit, hist, max, pal, color, ascii = false, cells = 30) {
  const val = value == null ? "–" : `${value}${unit ? ` ${unit}` : ""}`;
  const rest = Math.max(2, cells - 7); // two single spaces around the value
  let valueW = Math.min(12, rest);
  let sparkW = Math.min(10, rest - valueW);
  if (sparkW < 4) { sparkW = 0; valueW = rest; }
  const parts = [
    f.paint(f.pad(label, 6), pal.muted, color),
    f.bold(f.truncate(val, valueW), color),
    sparkW ? f.paint(f.spark(hist, { cells: sparkW, max, ascii }), pal.accent, color) : null,
  ].filter((x) => x != null);
  return f.pad(parts.join(" "), cells);
}

// Two cells with a two-cell gutter: 2 + cellW + 2 + cellW always fits the iw-4
// inner width, so the right border lands on the same column at any panel size.
function metricCellWidth(iw) {
  return Math.min(30, Math.floor((iw - 8) / 2));
}

function metricRow(a, b, iw, pal, color) {
  const half = metricCellWidth(iw);
  return row(`  ${f.pad(a, half)}  ${b}`, iw, pal, color);
}

// One expanded panel for one server.
function panel(entry, { iw, pal, color, tick, mascotOn, ascii }) {
  const { server, payload, focused } = entry;
  const d = derive(payload);
  const lines = [];
  const latency = payload?.latencyMs != null ? ` ${payload.latencyMs}ms` : "";
  const mark = mascot.burst(tick);
  const tag = stateTag(d.state, pal, color);
  lines.push(top(`${focused ? "▸" : " "} ${mark} ${f.truncate(server.name, 24)} · ${tag}${latency}`, iw, pal, color));
  // The url and the model share the row exactly: a fixed 40-cell url plus a
  // model truncated to iw-46 overflowed the inner width on a narrow panel.
  const urlW = Math.max(10, Math.min(40, iw - 19));
  const modelW = Math.max(8, iw - 4 - 5 - urlW);
  lines.push(row(`${f.paint(f.truncate(server.url, urlW), pal.muted, color)}  ·  ${f.truncate(d.model, modelW)}`, iw, pal, color));

  const art = mascotOn ? mascot.frame(d.state, tick, ascii) : null;
  const side = [
    `${f.paint(f.pad(server.id, 8), pal.muted, color)} ${tag}`,
    `  ${f.bold(f.truncate(d.label, iw - mascot.W - 7), color)}`,
    `  ${f.paint(f.truncate(d.detail, iw - mascot.W - 7), pal.muted, color)}`,
    `  ${f.paint(f.bar(d.pct / 100, { cells: Math.max(8, iw - mascot.W - 7), ascii }), d.pct > 80 ? pal.good : pal.accent, color)}`,
    `  ${f.paint(`refresh ${f.pad(String(Math.round(server.refreshMs / 100) / 10), 4)}s · key ${server.keySource}`, pal.muted, color)}`,
  ];
  const inner = iw - mascot.W - 5; // the cell beside the art, borders excluded
  for (let i = 0; i < (mascotOn ? mascot.H : STATUS_ROWS); i++) {
    const head = mascotOn ? f.paint(art[i], pal[f.STATE_ROLE[d.state] || "muted"], color) : " ".repeat(mascot.W);
    // pad after truncate, so the right border lands on the same column as every
    // other row no matter how short this line's text is.
    lines.push(f.paint("│ ", pal.border, color)
      + `${head} ${f.pad(f.truncate(side[i] ?? "", inner), inner)}`
      + f.paint(" │", pal.border, color));
  }

  // fmt(), not a template literal: tok_s arrives with float noise that would
  // otherwise print as "41.200000000000004".
  const speedVal = d.speed == null ? null : f.fmt(d.speed, 1);
  const cellW = metricCellWidth(iw);
  const speedCell = metricCell("Speed", speedVal, "t/s", d.history.tok_s, undefined, pal, color, ascii, cellW);
  const pcieCell = metricCell("PCIe", d.pcie, d.pcieSub ? f.truncate(d.pcieSub, 14) : "", d.history.gpu_pcie_rx_mb, undefined, pal, color, ascii, cellW);
  const cpuCell = metricCell("CPU", d.cpu, "%", d.history.cpu, 100, pal, color, ascii, cellW);
  const diskCell = metricCell("Disk", d.disk, d.diskSub ? f.truncate(d.diskSub, 16) : "", d.history.disk_read_mb, undefined, pal, color, ascii, cellW);

  if (d.gpus.length) {
    // The consolidated GPU/VRAM/Temp/Power cards would only repeat what the
    // rows below say per slot, so Speed pairs with PCIe and CPU with Disk.
    lines.push(metricRow(speedCell, pcieCell, iw, pal, color));
    const nameW = Math.min(24, Math.max(10, iw - 58));
    const parts = d.gpus.map((g) => ({
      g,
      util: g.util == null ? "–" : f.truncate(`${f.fmt(g.util)}%`, 5),
      vram: g.memUsed == null ? "–" : `${f.gb(g.memUsed)}/${g.memTotal == null ? "–" : f.gb(g.memTotal, 0)} GB`,
      temp: g.temp == null ? "–" : `${f.fmt(g.temp)} °C`,
      power: g.power == null ? "–" : `${f.fmt(g.power)} W`,
      pcie: g.pcieGen ? ` · Gen${g.pcieGen}${g.pcieWidth ? ` x${g.pcieWidth}` : ""}` : "",
    }));
    // The bar gets whatever the value text does not need: a fixed reservation
    // let the greedy bar push the power/PCIe tail past the inner width, and
    // row()'s truncate cut it away at every terminal size.
    const labelW = Math.max(...parts.map((p) => `GPU ${p.g.index}`.length));
    const valW = Math.max(...parts.map((p) => f.width(`${p.util} · ${p.vram} · ${p.temp} · ${p.power}${p.pcie}`)));
    const barW = Math.max(6, iw - 4 - 8 - labelW - nameW - valW); // four double-spaces
    for (const p of parts) {
      lines.push(row(`  ${f.paint(`GPU ${p.g.index}`, pal.muted, color)}  `
        + `${f.pad(f.truncate(shortGpuName(p.g.name), nameW), nameW)}  `
        + f.paint(f.bar(p.g.util == null ? 0 : p.g.util / 100, { cells: barW, ascii }), pal.accent, color)
        + `  ${f.bold(p.util, color)} · ${p.vram} · ${p.temp} · ${p.power}${p.pcie}`, iw, pal, color));
    }
    lines.push(metricRow(cpuCell, diskCell, iw, pal, color));
  } else {
    lines.push(metricRow(speedCell, metricCell("GPU", d.gpu, "%", d.history.gpu_util, 100, pal, color, ascii, cellW), iw, pal, color));
    lines.push(metricRow(
      metricCell("VRAM", d.vramUsed, d.vramTotal ? `/ ${d.vramTotal} GB` : "GB", d.history.gpu_mem_used, d.vramTotal ? Number(d.vramTotal) * 1073741824 : undefined, pal, color, ascii, cellW),
      metricCell("Temp", d.temp, "°C", d.history.gpu_temp, 90, pal, color, ascii, cellW),
      iw, pal, color,
    ));
    lines.push(metricRow(
      metricCell("Power", d.power, "W", d.history.gpu_power, d.powerLimit ? Number(d.powerLimit) : undefined, pal, color, ascii, cellW),
      pcieCell,
      iw, pal, color,
    ));
    lines.push(metricRow(cpuCell, diskCell, iw, pal, color));
  }

  const ctxPct = `${Math.round(d.ctxFrac * 100)}%`;
  // "  Ctx  " (7) + pct(4) + space + bar + two spaces + tail = iw-4. The tail
  // used to be a fixed 22 on top of a greedy bar, which overflowed and got
  // silently cut by row() at every width.
  const ctxTail = Math.min(22, Math.max(10, iw - 34));
  const ctxBar = f.paint(f.bar(d.ctxFrac, { cells: Math.max(4, iw - 19 - ctxTail), ascii }), d.ctxFrac > 0.9 ? pal.bad : pal.good, color);
  lines.push(row(`  Ctx  ${f.bold(f.pad(ctxPct, 4), color)} ${ctxBar}  ${f.truncate(`${f.kfmt(d.ctxUsed)} / ${f.ctxfmt(d.ctxMax)}`, ctxTail)}`, iw, pal, color));

  // "  Cache " (8) + cache + two spaces + "RAM " (4) + ram + space + bar = iw-4.
  const budget = iw - 19;
  const ramBar = Math.min(10, Math.max(4, budget - 42));
  const cacheW = Math.min(26, Math.max(6, budget - 16 - ramBar));
  const ramW = Math.min(16, Math.max(6, budget - cacheW - ramBar));
  lines.push(row(`  ${f.paint("Cache", pal.muted, color)} ${f.pad(f.truncate(d.cache, cacheW), cacheW)}  `
    + `${f.paint("RAM", pal.muted, color)} ${f.pad(f.truncate(d.ram, ramW), ramW)} ${f.paint(f.bar(d.ramFrac, { cells: ramBar, ascii }), d.ramFrac > 0.92 ? pal.bad : pal.accent, color)}`, iw, pal, color));

  lines.push(row(`  ${f.paint("Last ", pal.muted, color)}${f.truncate(d.lastRequest || "no requests yet", iw - 11)}`, iw, pal, color));
  lines.push(bottom(iw, pal, color));
  return lines;
}

// One line per server, the terminal twin of the widget's compact strip.
function stripLine(entry, { iw, pal, color, tick, mascotOn, ascii }) {
  const { server, payload, focused } = entry;
  const d = derive(payload);
  const role = f.STATE_ROLE[d.state] || "muted";
  const face = mascotOn ? f.paint(mascot.inline(d.state, ascii), pal[role], color) : "  ";
  // derive() hands speed over as a number, and pad() counts cells on a string:
  // format it here or a generating server crashes the whole draw.
  const speed = d.speed == null ? "–" : f.fmt(d.speed, 1);
  const gpu = d.gpu == null ? "–" : d.gpu;
  const ctx = d.ctxMax ? `${Math.round(d.ctxFrac * 100)}%` : "–";
  const sp = f.paint(f.spark(d.history.tok_s, { cells: 12, ascii }), pal.accent, color);
  const line = `${focused ? "▸" : " "} ${f.paint(mascot.burst(tick), pal.accent, color)} `
    + `${f.bold(f.pad(f.truncate(server.name, 14), 14), color)} ${face} `
    + `${f.paint(f.pad(f.truncate(d.state, 10), 10), pal[role], color)} `
    + `${f.pad(speed, 5)} t/s · GPU ${f.pad(gpu, 3)}%`
    + (d.gpus.length > 1 ? ` ×${d.gpus.length}` : "")
    + ` · CTX ${f.pad(ctx, 4)} ${sp}`;
  return f.truncate(line, iw);
}

function header({ entries, theme, color, pal, tick, configSource, refreshMs, iw }) {
  const servers = entries.length;
  const mark = f.paint(mascot.burst(tick), pal.accent, color);
  return f.truncate(`${mark} ${f.bold("Strata CLI", color)}  ·  ${servers} server${servers === 1 ? "" : "s"}`
    + `  ·  refresh ${(refreshMs / 1000).toFixed(1)}s  ·  theme ${theme}`
    + `  ·  ${f.paint(configSource, pal.muted, color)}`, iw);
}

const HELP = "q quit · space refresh · c compact · d theme · m mascot · 1-9 focus · ↑/↓ select";

function render(options) {
  const { entries, width = 80, height = 24, theme = "dark", color = true, ascii = false } = options;
  const pal = f.PALETTES[theme] || f.PALETTES.dark;
  // 40 rather than 48: a 40-column console is real (the kernel console is
  // 80x50, but tmux panes and small terminals are not), and every row now sums
  // to iw-4 instead of clamping up and overflowing.
  const iw = Math.max(40, width);
  const tick = options.tick ?? 0;
  const mascotOn = options.mascot !== false;
  const lines = [];

  for (const w of options.warnings || []) lines.push(f.paint(`! ${w}`, pal.warn, color));
  lines.push(header({ entries, theme, color, pal, tick, iw, configSource: options.configSource || "defaults", refreshMs: options.refreshMs || 1000 }));

  // Compact per server whenever the expanded panels would not fit the screen.
  const wanted = entries.reduce((h, e) => h + panelRows(e.payload, mascotOn), 0) + 2 + (options.warnings || []).length;
  const compactAll = options.compact || wanted > height;
  for (const entry of entries) {
    if (compactAll) lines.push(stripLine(entry, { iw, pal, color, tick, mascotOn, ascii }));
    else lines.push(...panel(entry, { iw, pal, color, tick, mascotOn, ascii }));
  }

  lines.push(f.paint(f.truncate(HELP, iw), pal.muted, color));
  // One pass over the finished frame: every non-ASCII glyph in the UI (borders,
  // mascot, bars, sparklines, dots) falls back to a same-width ASCII twin.
  return ascii ? lines.map(f.asciiize) : lines;
}

module.exports = { render, panel, stripLine, derive, PANEL_ROWS, panelRows, shortGpuName, HELP };
