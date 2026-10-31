// The live loop: per-server poll timers, an animation clock, and key handling.
// Poll rate comes from the config; the mascot animates on its own faster clock
// so a 5s refresh still looks alive between polls.
const { load } = require("./config.js");
const { Poller } = require("./client.js");
const { render } = require("./render.js");
const { colorMode } = require("./format.js");

const FRAME_MS = 125; // 8 fps animation cadence
const UP = "\x1b[A";
const DOWN = "\x1b[B";

function start(options = {}) {
  // A pre-resolved config wins: bin/strata.js builds one from --server flags,
  // and re-reading the file here would silently watch strata.json instead.
  const cfg = options.config || load(options);
  const tty = Boolean(process.stdout.isTTY);
  const state = {
    theme: options.theme || cfg.theme,
    compact: options.compact ?? cfg.compact,
    mascot: options.mascot ?? cfg.mascot,
    // A mode string, not a boolean: paint() picks 24-bit or the named ANSI
    // colors depending on what this terminal advertises.
    color: colorMode(options.color, process.env, tty),
    tick: 0,
    focus: 0,
  };
  const entries = cfg.servers.map((server) => ({ server, payload: null }));
  const pollers = entries.map((entry) => new Poller(entry.server, {
    onPoll: (payload) => { entry.payload = payload; draw(); },
  }));

  const out = process.stdout;
  const stdin = tty ? process.stdin : null;

  function draw() {
    const height = tty ? (process.stdout.rows || 24) : 24;
    const width = tty ? (process.stdout.columns || 80) : 80;
    // The ▸ marker and the header's refresh rate both follow state.focus, so
    // stamp it onto the entries at draw time rather than on every key press.
    entries.forEach((entry, i) => { entry.focused = i === state.focus; });
    const lines = render({
      entries, width, height, theme: state.theme, color: state.color,
      compact: state.compact, mascot: state.mascot, tick: state.tick,
      configSource: cfg.source, refreshMs: entries[state.focus]?.server.refreshMs ?? cfg.servers[0].refreshMs,
      warnings: cfg.warnings,
    });
    // Home, then rewrite every line with its tail cleared, then erase whatever
    // is left below the last line: compact mode and a shrink on resize would
    // otherwise leave the previous taller frame's leftovers on screen. No
    // full-screen clear per frame, so the widget does not flicker while animating.
    let s = "\x1b[H";
    for (const line of lines) s += `${line}\x1b[K\n`;
    s += "\x1b[0J";
    out.write(s);
  }

  function focusIndex(i) {
    state.focus = Math.max(0, Math.min(entries.length - 1, i));
    draw();
  }

  function onKey(data) {
    const key = data.toString();
    if (key === "q" || key === "Q" || key === "\x03" || key === "\x1b") return stop(0);
    if (key === " ") { for (const p of pollers) p.tick(); return; }
    if (key === "c") { state.compact = !state.compact; return draw(); }
    if (key === "d") { state.theme = state.theme === "dark" ? "light" : "dark"; return draw(); }
    if (key === "m") { state.mascot = !state.mascot; return draw(); }
    if (key === UP) return focusIndex(state.focus - 1);
    if (key === DOWN) return focusIndex(state.focus + 1);
    const digit = Number(key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= entries.length) return focusIndex(digit - 1);
  }

  function stop(code = 0) {
    clearInterval(clock);
    for (const p of pollers) p.stop();
    if (tty) {
      stdin?.setRawMode?.(false);
      stdin?.pause();
      out.write("\x1b[?25h\x1b[?1049l");
    }
    process.exit(code);
  }

  if (tty) {
    out.write("\x1b[?1049h\x1b[?25l\x1b[2J"); // alternate screen, hide cursor
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onKey);
    process.stdout.on("resize", draw);
  }

  for (const p of pollers) p.start();
  const clock = setInterval(() => { state.tick += 1; draw(); }, FRAME_MS);
  draw();
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));

  return { stop, state, entries, cfg };
}

module.exports = { start, FRAME_MS };
