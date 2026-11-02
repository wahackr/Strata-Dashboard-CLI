// Layout: polled payloads -> terminal lines. Mirrors the widget's card set
// (state card, eight metric cards, context card, last request) with box
// drawing instead of SVG. Pure, so tests can assert on strings without a TTY.
const f = require("./format.js");
const mascot = require("./mascot.js");
const { derive } = require("./derive.js");

const PANEL_ROWS = 15; // lines per expanded server panel, borders included

function top(label, iw, pal, color) {
  // Truncate before padding: a title longer than the box would otherwise push
  // the right border past the terminal width.
  const t = f.truncate(` ${label} `, Math.max(4, iw - 4));
  const rest = Math.max(1, iw - 3 - f.width(t));
  return `╭─${f.bold(t, color)}${"─".repeat(rest)}╮`;
}

function bottom(iw, pal, color) {
  return `╰${"─".repeat(iw - 2)}╯`;
}

function row(text, iw, pal, color) {
  return `│ ${f.truncate(f.pad(text, iw - 4), iw - 4)} │`;
}

function stateTag(state, pal, color) {
  return f.paint(`● ${state}`, pal[f.STATE_ROLE[state] || "muted"], color);
}

// label(6) + value(12) + spark(10) = 28 cells, so a row of two fits 60.
// Truncation happens on the pieces, never on the finished string: slicing a
// painted string would cut an ANSI code in half.
function metricCell(label, value, unit, hist, max, pal, color) {
  const val = value == null ? "–" : `${value}${unit ? ` ${unit}` : ""}`;
  const sp = f.paint(f.spark(hist, { cells: 10, max }), pal.accent, color);
  return `${f.paint(f.pad(label, 6), pal.muted, color)} ${f.bold(f.pad(f.truncate(val, 12), 12), color)} ${sp}`;
}

function metricRow(a, b, iw) {
  const half = Math.floor((iw - 6) / 2);
  return row(`  ${f.pad(a, half)}  ${b}`, iw);
}

// One expanded panel for one server.
function panel(entry, { iw, pal, color, tick, mascotOn }) {
  const { server, payload, focused } = entry;
  const d = derive(payload);
  const lines = [];
  const latency = payload?.latencyMs != null ? ` ${payload.latencyMs}ms` : "";
  const mark = mascot.burst(tick);
  const tag = stateTag(d.state, pal, color);
  lines.push(top(`${focused ? "▸" : " "} ${mark} ${f.truncate(server.name, 24)} · ${tag}${latency}`, iw, pal, color));
  lines.push(row(`${f.paint(f.truncate(server.url, 40), pal.muted, color)}  ·  ${f.truncate(d.model, iw - 46)}`, iw, pal, color));

  const art = mascotOn ? mascot.frame(d.state, tick) : null;
  const side = [
    `${f.paint(f.pad(server.id, 8), pal.muted, color)} ${tag}`,
    `  ${f.bold(f.truncate(d.label, iw - 20), color)}`,
    `  ${f.paint(f.truncate(d.detail, iw - 20), pal.muted, color)}`,
    `  ${f.paint(f.bar(d.pct / 100, { cells: Math.max(8, iw - 22) }), d.pct > 80 ? pal.good : pal.accent, color)}`,
    `  ${f.paint(`refresh ${f.pad(String(Math.round(server.refreshMs / 100) / 10), 4)}s · key ${server.keySource}`, pal.muted, color)}`,
  ];
  const inner = iw - mascot.W - 5; // the cell beside the art, borders excluded
  for (let i = 0; i < mascot.H; i++) {
    const head = mascotOn ? f.paint(art[i], pal[f.STATE_ROLE[d.state] || "muted"], color) : " ".repeat(mascot.W);
    // pad after truncate, so the right border lands on the same column as every
    // other row no matter how short this line's text is.
    lines.push(`│ ${head} ${f.pad(f.truncate(side[i], inner), inner)} │`);
  }

  // fmt(), not a template literal: tok_s arrives with float noise that would
  // otherwise print as "41.200000000000004".
  const speedVal = d.speed == null ? null : f.fmt(d.speed, 1);
  lines.push(metricRow(
    metricCell("Speed", speedVal, "t/s", d.history.tok_s, undefined, pal, color),
    metricCell("GPU", d.gpu, "%", d.history.gpu_util, 100, pal, color),
    iw, pal, color,
  ));
  lines.push(metricRow(
    metricCell("VRAM", d.vramUsed, d.vramTotal ? `/ ${d.vramTotal} GB` : "GB", d.history.gpu_mem_used, d.vramTotal ? Number(d.vramTotal) * 1073741824 : undefined, pal, color),
    metricCell("Temp", d.temp, "°C", d.history.gpu_temp, 90, pal, color),
    iw, pal, color,
  ));
  lines.push(metricRow(
    metricCell("Power", d.power, "W", d.history.gpu_power, d.powerLimit ? Number(d.powerLimit) : undefined, pal, color),
    metricCell("PCIe", d.pcie, d.pcieSub ? f.truncate(d.pcieSub, 14) : "", d.history.gpu_pcie_rx_mb, undefined, pal, color),
    iw, pal, color,
  ));
  lines.push(metricRow(
    metricCell("CPU", d.cpu, "%", d.history.cpu, 100, pal, color),
    metricCell("Disk", d.disk, d.diskSub ? f.truncate(d.diskSub, 16) : "", d.history.disk_read_mb, undefined, pal, color),
    iw, pal, color,
  ));

  const ctxPct = `${Math.round(d.ctxFrac * 100)}%`;
  const ctxBar = f.paint(f.bar(d.ctxFrac, { cells: Math.max(10, iw - 30) }), d.ctxFrac > 0.9 ? pal.bad : pal.good, color);
  lines.push(row(`  Ctx  ${f.bold(f.pad(ctxPct, 4), color)} ${ctxBar}  ${f.truncate(`${f.kfmt(d.ctxUsed)} / ${f.ctxfmt(d.ctxMax)}`, 22)}`, iw, pal, color));

  lines.push(row(`  ${f.paint("Cache", pal.muted, color)} ${f.truncate(d.cache, 26)}  `
    + `${f.paint("RAM", pal.muted, color)} ${f.truncate(d.ram, 16)} ${f.paint(f.bar(d.ramFrac, { cells: 10 }), d.ramFrac > 0.92 ? pal.bad : pal.accent, color)}`, iw, pal, color));

  lines.push(row(`  ${f.paint("Last ", pal.muted, color)}${f.truncate(d.lastRequest || "no requests yet", iw - 10)}`, iw, pal, color));
  lines.push(bottom(iw, pal, color));
  return lines;
}

// One line per server, the terminal twin of the widget's compact strip.
function stripLine(entry, { iw, pal, color, tick, mascotOn }) {
  const { server, payload, focused } = entry;
  const d = derive(payload);
  const role = f.STATE_ROLE[d.state] || "muted";
  const face = mascotOn ? f.paint(mascot.inline(d.state), pal[role], color) : "  ";
  // derive() hands speed over as a number, and pad() counts cells on a string:
  // format it here or a generating server crashes the whole draw.
  const speed = d.speed == null ? "–" : f.fmt(d.speed, 1);
  const gpu = d.gpu == null ? "–" : d.gpu;
  const ctx = d.ctxMax ? `${Math.round(d.ctxFrac * 100)}%` : "–";
  const sp = f.paint(f.spark(d.history.tok_s, { cells: 12 }), pal.accent, color);
  const line = `${focused ? "▸" : " "} ${f.paint(mascot.burst(tick), pal.accent, color)} `
    + `${f.bold(f.pad(f.truncate(server.name, 14), 14), color)} ${face} `
    + `${f.paint(f.pad(f.truncate(d.state, 10), 10), pal[role], color)} `
    + `${f.pad(speed, 5)} t/s · GPU ${f.pad(gpu, 3)}% · CTX ${f.pad(ctx, 4)} ${sp}`;
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
  const { entries, width = 80, height = 24, theme = "dark", color = true } = options;
  const pal = f.PALETTES[theme] || f.PALETTES.dark;
  const iw = Math.max(48, Math.min(width, 120));
  const tick = options.tick ?? 0;
  const mascotOn = options.mascot !== false;
  const lines = [];

  for (const w of options.warnings || []) lines.push(f.paint(`! ${w}`, pal.warn, color));
  lines.push(header({ entries, theme, color, pal, tick, iw, configSource: options.configSource || "defaults", refreshMs: options.refreshMs || 1000 }));

  // Compact per server whenever the expanded panels would not fit the screen.
  const wanted = entries.length * PANEL_ROWS + 2;
  const compactAll = options.compact || wanted > height;
  for (const entry of entries) {
    if (compactAll && !(entries.length === 1 && !options.compact)) lines.push(stripLine(entry, { iw, pal, color, tick, mascotOn }));
    else lines.push(...panel(entry, { iw, pal, color, tick, mascotOn }));
  }

  lines.push(f.paint(f.truncate(HELP, iw), pal.muted, color));
  return lines;
}

module.exports = { render, panel, stripLine, derive, PANEL_ROWS, HELP };
