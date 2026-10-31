// Config resolution: defaults, multi-server files, credential precedence,
// refresh-rate clamping, and error handling. Run: node test/config.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { load, parse, normalizeUrl, resolveApiKey, ConfigError } = require("../strata-cli/config.js");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strata-cli-test-"));
const empty = path.join(dir, "xdg-empty");
fs.mkdirSync(empty, { recursive: true });
// Keep the real ~/.config out of the picture.
const env0 = { XDG_CONFIG_HOME: empty, HOME: dir };

const write = (name, text, mode = 0o600) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  fs.chmodSync(file, mode);
  return file;
};

// Nothing on disk: one default server, like the widget's first run.
const bare = load({ env: env0, cwd: dir });
assert.equal(bare.servers.length, 1, "defaults give one server");
assert.equal(bare.servers[0].url, "http://127.0.0.1:8080", "default url");
assert.equal(bare.servers[0].apiKey, "", "no key by default");
assert.equal(bare.servers[0].refreshMs, 1000, "default refresh");
assert.equal(bare.theme, "dark");
assert.equal(bare.source, "defaults");

// A flat object is a legacy single-server file, same migration the widget does.
const legacy = write("legacy.json", JSON.stringify({ url: "http://box:9000", apiKey: "k1", pollMs: 1500 }));
const fromLegacy = load({ configPath: legacy, env: env0, cwd: dir });
assert.equal(fromLegacy.servers.length, 1, "flat file becomes one server");
assert.equal(fromLegacy.servers[0].url, "http://box:9000");
assert.equal(fromLegacy.servers[0].apiKey, "k1");
assert.equal(fromLegacy.servers[0].refreshMs, 1500, "pollMs is accepted as refreshMs");

// Several servers, each with its own address, credentials and refresh rate.
const multi = write("multi.json", JSON.stringify({
  refreshMs: 1000,
  servers: [
    { name: "Home", url: "http://127.0.0.1:8080", apiKey: "home-key" },
    { name: "Office", url: "https://office.lan:8443/", apiKey: "stale", apiKeyEnv: "OFFICE_KEY", refreshMs: 2500 },
    { url: "192.168.1.9:8080", refreshMs: 100 },
  ],
}));
const env2 = { ...env0, OFFICE_KEY: "office-key" };
const cfg = load({ configPath: multi, env: env2, cwd: dir });
assert.equal(cfg.servers.length, 3, "one entry per configured server");
assert.deepEqual(cfg.servers.map((s) => s.name), ["Home", "Office", "Strata 3"],
  "explicit names are kept, unnamed servers fall back to a numbered label");
assert.equal(cfg.servers[1].url, "https://office.lan:8443", "trailing slash trimmed, scheme kept");
assert.equal(cfg.servers[2].url, "http://192.168.1.9:8080", "scheme added when absent");
assert.equal(cfg.servers[1].apiKey, "office-key", "environment key beats the stale file key");
assert.equal(cfg.servers[1].keySource, "env:OFFICE_KEY");
assert.equal(cfg.servers[0].apiKey, "home-key", "file key still works when no env is set");
assert.equal(cfg.servers[1].refreshMs, 2500, "per-server refresh rate");
assert.equal(cfg.servers[2].refreshMs, 250, "refresh rate clamped to the 250ms floor");
assert.deepEqual(new Set(cfg.servers.map((s) => s.id)).size, 3, "ids stay distinct");

// An env var that is set but empty must not silently drop the key.
const noEnv = load({ configPath: multi, env: env0, cwd: dir });
assert.equal(noEnv.servers[1].apiKey, "stale", "missing env falls back to the file key");

// Plaintext key in a world-readable file is worth a warning.
const loose = write("loose.json", JSON.stringify({ url: "http://x:1", apiKey: "secret" }), 0o644);
const warn = load({ configPath: loose, env: env0, cwd: dir });
assert.equal(warn.warnings.length, 1, "loose permissions warn");
assert.match(warn.warnings[0], /readable by other users/);
const tight = load({ configPath: write("tight.json", JSON.stringify({ url: "http://x:1", apiKey: "secret" }), 0o600), env: env0, cwd: dir });
assert.equal(tight.warnings.length, 0, "0600 is quiet");

// Errors are errors, not silent fallbacks.
assert.throws(() => load({ configPath: "nope.json", env: env0, cwd: dir }), ConfigError, "missing --config is an error");
assert.throws(() => parse("{ not json", { env: env0 }), SyntaxError, "bad JSON surfaces");
assert.throws(() => normalizeUrl("   "), ConfigError, "empty url rejected");
const dupes = parse(JSON.stringify({ servers: [{ url: "http://a:1", id: "same" }, { url: "http://b:1", id: "same" }] }), { env: env0 });
assert.deepEqual(new Set(dupes.servers.map((s) => s.id)).size, 2, "a repeated id is rewritten, not reused");

assert.deepEqual(normalizeUrl("https://a.b:8080///"), "https://a.b:8080");
assert.deepEqual(resolveApiKey({ apiKeyEnv: "K", apiKey: "file" }, { K: "env" }), { apiKey: "env", source: "env:K" });
assert.deepEqual(resolveApiKey({ apiKeyEnv: "K", apiKey: "file" }, {}), { apiKey: "file", source: "config" });
assert.deepEqual(resolveApiKey({}, {}), { apiKey: "", source: "none" });

assert.equal(parse("[]", { env: env0 }).servers.length, 1, "empty server list still gives one server");
assert.equal(parse(JSON.stringify({ url: "http://a:1", theme: "light" }), { env: env0 }).theme, "light");
assert.equal(parse(JSON.stringify({ url: "http://a:1", theme: "neon" }), { env: env0 }).theme, "dark", "unknown theme falls back");

fs.rmSync(dir, { recursive: true, force: true });
console.log("config resolution, credential precedence, refresh clamping and permission warnings OK");
