// Config: which Strata servers to watch, with what credentials, how often.
// Mirrors the widget's profile list (electron/main.js DEFAULTS + loadConfig),
// but reads a plain JSON file instead of an app-managed settings.json.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_REFRESH_MS = 1000;
// Same floor the widget's poll timer uses, so a 0 in the config cannot spin.
const MIN_REFRESH_MS = 250;
const DEFAULT_TIMEOUT_MS = 4000;
const MIN_TIMEOUT_MS = 500;
const DEFAULT_NAME = "Strata";
const DEFAULT_URL = "http://127.0.0.1:8080";
const DEFAULT_THEME = "dark";

class ConfigError extends Error {}

const SLASHES = /\/+$/;
const HAS_SCHEME = /^https?:\/\//;

function normalizeUrl(value) {
  const v = String(value ?? "").trim().replace(SLASHES, "");
  if (!v) throw new ConfigError("server url is empty");
  return HAS_SCHEME.test(v) ? v : `http://${v}`;
}

function clampInt(value, fallback, min) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return Math.max(min, fallback);
  return Math.max(min, Math.round(n));
}

// A key read from the environment beats a stale key left in the file — the same
// "the newest, most explicit value wins" rule the widget applies to a key that
// was just typed into Settings.
function resolveApiKey(raw, env) {
  const envName = raw.apiKeyEnv ? String(raw.apiKeyEnv).trim() : "";
  if (envName) {
    const fromEnv = env[envName];
    if (fromEnv) return { apiKey: String(fromEnv), source: `env:${envName}` };
  }
  if (raw.apiKey) return { apiKey: String(raw.apiKey), source: "config" };
  return { apiKey: "", source: "none" };
}

function normalizeServer(raw, index, globals, env, taken) {
  const merged = { ...globals, ...raw };
  const name = String(merged.name || `${DEFAULT_NAME} ${index + 1}`).trim();
  const key = resolveApiKey(merged, env);
  let id = String(merged.id || "").trim();
  if (!id || taken.has(id)) id = `srv-${index + 1}`;
  taken.add(id);
  return {
    id,
    name,
    url: normalizeUrl(merged.url),
    apiKey: key.apiKey,
    keySource: key.source,
    refreshMs: clampInt(merged.refreshMs, DEFAULT_REFRESH_MS, MIN_REFRESH_MS),
    timeoutMs: clampInt(merged.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS),
  };
}

// Candidates, most specific first. A file that exists but fails to parse is an
// error, not a silent fall through to the next candidate.
function candidates(env, cwd) {
  const out = [];
  if (env.STRATA_CONFIG) out.push(path.resolve(cwd, env.STRATA_CONFIG));
  out.push(path.resolve(cwd, "strata.json"));
  const xdg = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  out.push(path.join(xdg, "strata-cli", "config.json"));
  return out;
}

function defaultConfigPath(env = process.env, cwd = process.cwd()) {
  return candidates(env, cwd)[0];
}

function parse(rawText, { env = process.env, source = "config", warnings = [] }) {
  const doc = JSON.parse(rawText);
  if (Array.isArray(doc)) doc = { servers: doc };
  if (typeof doc !== "object" || doc === null) throw new ConfigError("config must be an object or a server list");

  // A flat object is a single-server config; the widget migrates those the
  // same way, so an old settings.json stays readable.
  // An empty document watches the default server; an entry that is missing its
  // url is a mistake in the file, so normalizeUrl still rejects it.
  const list = Array.isArray(doc.servers) && doc.servers.length
    ? doc.servers
    : doc.url ? [doc] : [{ url: DEFAULT_URL }];

  const globals = {
    refreshMs: doc.refreshMs ?? doc.pollMs,
    timeoutMs: doc.timeoutMs,
  };
  const taken = new Set();
  const servers = list.map((raw, i) => normalizeServer(raw, i, globals, env, taken));

  const theme = doc.theme === "light" ? "light" : doc.theme === "dark" ? "dark" : DEFAULT_THEME;

  return {
    source,
    theme,
    compact: Boolean(doc.compact),
    mascot: doc.mascot === undefined ? true : Boolean(doc.mascot),
    servers,
    warnings,
  };
}

// Warn, never refuse: a readable config file is a common mistake, and a
// plaintext Bearer key is the reason it matters.
function permissionWarnings(file, env) {
  if (!file || env.STRATA_CLI_ALLOW_INSECURE_CONFIG) return [];
  let mode = 0;
  try { mode = fs.statSync(file).mode & 0o777; } catch { return []; }
  if (mode & 0o077) return [`${file} is readable by other users (${mode.toString(8)}); it may hold API keys (chmod 600)`];
  return [];
}

function load({ configPath, env = process.env, cwd = process.cwd() } = {}) {
  if (configPath) {
    const file = path.resolve(cwd, configPath);
    let text;
    try { text = fs.readFileSync(file, "utf8"); }
    catch (e) { throw new ConfigError(`cannot read ${file}: ${e.message}`); }
    return parse(text, { env, source: file, warnings: permissionWarnings(file, env) });
  }

  for (const file of candidates(env, cwd)) {
    let text = null;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    return parse(text, { env, source: file, warnings: permissionWarnings(file, env) });
  }

  // Nothing on disk: one default server, exactly like the widget's first run.
  const taken = new Set();
  return {
    source: "defaults",
    theme: DEFAULT_THEME,
    compact: false,
    mascot: true,
    servers: [normalizeServer({ url: DEFAULT_URL }, 0, {}, env, taken)],
    warnings: [],
  };
}

module.exports = {
  load,
  parse,
  normalizeUrl,
  normalizeServer,
  resolveApiKey,
  defaultConfigPath,
  ConfigError,
  DEFAULT_REFRESH_MS,
  MIN_REFRESH_MS,
  DEFAULT_TIMEOUT_MS,
};
