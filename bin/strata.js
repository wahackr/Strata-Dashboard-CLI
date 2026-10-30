#!/usr/bin/env node
// strata — terminal monitor for one or more Strata inference servers.
const { load, normalizeUrl, ConfigError } = require("../strata-cli/config.js");
const { poll, stateOf } = require("../strata-cli/client.js");
const { render } = require("../strata-cli/render.js");

const USAGE = `strata — live monitor for Strata inference servers

Usage
  strata [options]

Options
  --config <file>      config file (default: $STRATA_CONFIG, ./strata.json,
                       ~/.config/strata-cli/config.json)
  --server <url>       watch this server instead of the config file; repeatable
  --name <name>        label for --server (default: its host)
  --key <key>          Bearer key for the --server it follows
  --interval <ms|1.5s> refresh rate for every server (default: 1000)
  --timeout <ms>       metrics request timeout (default: 4000; /health uses 6000)
  --theme <dark|light> color theme (default: from config, else dark)
  --compact            one line per server, like the widget's compact strip
  --no-mascot          draw the panels without the animated blob
  --no-color           plain text, no ANSI
  --once               poll each server once, print, and exit
  --json               with --once, print raw payloads instead of the panel
  --help               this help

Keys
  q quit · space refresh now · c compact · d theme · m mascot · 1-9 focus · ↑/↓ select

Config file (JSON)
  {
    "refreshMs": 1000,
    "theme": "dark",
    "servers": [
      { "name": "Home",   "url": "http://127.0.0.1:8080", "apiKey": "…" },
      { "name": "Office", "url": "http://192.168.1.20:8080",
        "apiKeyEnv": "STRATA_OFFICE_KEY", "refreshMs": 2000 }
    ]
  }
`;

function parseArgs(argv) {
  const opts = { servers: [], color: undefined, mascot: undefined, compact: undefined };
  const take = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined) throw new ConfigError(`${name} needs a value`);
    return v;
  };
  const duration = (v, name) => {
    const n = /s$/i.test(v) ? Number(v.replace(/s$/i, "")) * 1000 : Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new ConfigError(`${name} must be a duration like 1500 or 1.5s`);
    return Math.max(250, Math.round(n));
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--config") opts.configPath = take(++i, "--config");
    else if (a === "--server") opts.servers.push({ url: take(++i, "--server") });
    else if (a === "--name") {
      if (!opts.servers.length) throw new ConfigError("--name must follow a --server");
      opts.servers[opts.servers.length - 1].name = take(++i, "--name");
    } else if (a === "--key") {
      if (!opts.servers.length) throw new ConfigError("--key must follow a --server");
      opts.servers[opts.servers.length - 1].apiKey = take(++i, "--key");
    } else if (a === "--interval") opts.refreshMs = duration(take(++i, "--interval"), "--interval");
    else if (a === "--timeout") opts.timeoutMs = duration(take(++i, "--timeout"), "--timeout");
    else if (a === "--theme") {
      const v = take(++i, "--theme");
      if (v !== "dark" && v !== "light") throw new ConfigError("--theme is dark or light");
      opts.theme = v;
    } else if (a === "--compact") opts.compact = true;
    else if (a === "--mascot") opts.mascot = true;
    else if (a === "--no-mascot") opts.mascot = false;
    else if (a === "--no-color") opts.color = false;
    else if (a === "--color") opts.color = true;
    else if (a === "--once") opts.once = true;
    else if (a === "--json") opts.json = true;
    else throw new ConfigError(`unknown option ${a}`);
  }
  return opts;
}

// --server beats the config file: an explicit command line is the newest,
// most explicit source, the same precedence rule config.js uses for keys.
function cliConfig(opts) {
  const taken = new Set();
  const servers = opts.servers.map((raw, i) => {
    const url = normalizeUrl(raw.url);
    const name = raw.name || new URL(url).hostname;
    taken.add(`srv-${i + 1}`);
    return {
      id: `srv-${i + 1}`, name, url,
      apiKey: raw.apiKey || "", keySource: raw.apiKey ? "cli" : "none",
      refreshMs: opts.refreshMs ?? 1000, timeoutMs: opts.timeoutMs ?? 4000,
    };
  });
  return { source: "command line", theme: opts.theme || "dark", compact: opts.compact ?? false, mascot: opts.mascot ?? true, servers, warnings: [] };
}

async function runOnce(cfg, opts) {
  const entries = [];
  for (const server of cfg.servers) {
    entries.push({ server, payload: await poll(server), focused: entries.length === 0 });
  }
  if (opts.json) {
    console.log(JSON.stringify(entries.map(({ server, payload }) => ({
      name: server.name, url: server.url, ok: payload.ok, status: payload.status,
      state: stateOf(payload), error: payload.error || null, latencyMs: payload.latencyMs,
      metrics: payload.metrics, health: payload.health,
    })), null, 2));
    return entries.some((e) => e.payload.ok) ? 0 : 1;
  }
  const lines = render({
    entries, width: process.stdout.columns || 80, height: process.stdout.rows || 24,
    theme: opts.theme || cfg.theme,
    // Same rule as app.js: color only when the terminal asks for it, so piping
    // the snapshot into another program yields plain text.
    color: opts.color === undefined ? Boolean(process.stdout.isTTY) && !process.env.NO_COLOR : opts.color,
    compact: opts.compact ?? cfg.compact, mascot: opts.mascot ?? cfg.mascot,
    tick: 0, configSource: cfg.source, refreshMs: cfg.servers[0].refreshMs, warnings: cfg.warnings,
  });
  console.log(lines.join("\n"));
  return entries.some((e) => e.payload.ok) ? 0 : 1;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (e) { console.error(`strata: ${e.message}`); process.exit(2); }
  if (opts.help) { console.log(USAGE); return; }

  const cfg = opts.servers.length ? cliConfig(opts) : load(opts);
  if (opts.once || !process.stdout.isTTY) {
    if (!process.stdout.isTTY && !opts.once) console.error("strata: not a terminal, printing one snapshot");
    process.exit(await runOnce(cfg, opts));
  }
  require("../strata-cli/app.js").start({ ...opts, theme: opts.theme });
}

main().catch((e) => { console.error(`strata: ${e.message}`); process.exit(1); });
