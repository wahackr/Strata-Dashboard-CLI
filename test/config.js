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

// ---- command-line flags: a value belongs to the flag it follows ----
const { parseArgs, cliConfig } = require("../bin/strata.js");
const cli = parseArgs(["--server", "http://127.0.0.1:8080", "--name", "Home", "--key", "k1", "--interval", "1.5s", "--once", "--json"]);
assert.equal(cli.servers.length, 1);
assert.equal(cli.servers[0].url, "http://127.0.0.1:8080", "the url is its own flag's argument, not the next one's");
assert.equal(cli.servers[0].name, "Home");
assert.equal(cli.servers[0].apiKey, "k1");
assert.equal(cli.refreshMs, 1500, "--interval 1.5s is a duration");
assert.equal(cli.once, true, "a later flag is not consumed as a value");
assert.equal(cli.json, true);
assert.deepEqual(cliConfig(cli).servers[0], {
  id: "srv-1", name: "Home", url: "http://127.0.0.1:8080", apiKey: "k1",
  keySource: "cli", refreshMs: 1500, timeoutMs: 4000,
});
assert.equal(cliConfig(cli).source, "command line", "--server beats the config file");

const repeated = parseArgs(["--server", "http://a:1", "--server", "http://b:2"]);
assert.deepEqual(repeated.servers.map((s) => s.url), ["http://a:1", "http://b:2"], "--server is repeatable");
assert.deepEqual(cliConfig(repeated).servers.map((s) => s.name), ["a", "b"], "unnamed servers are labelled by host");

assert.equal(parseArgs(["--color", "256"]).color, "256", "--color takes a mode");
assert.equal(parseArgs(["--color", "never"]).color, "never");
const colored = parseArgs(["--color", "256", "--compact", "--once"]);
assert.deepEqual([colored.color, colored.compact, colored.once], ["256", true, true], "a consumed mode leaves the next flags intact");
assert.equal(parseArgs(["--color", "--compact"]).color, true, "--color does not eat the next flag");
assert.equal(parseArgs(["--color"]).color, true);
assert.equal(parseArgs(["--no-color"]).color, false);

assert.throws(() => parseArgs(["--server"]), ConfigError, /needs a value/);
assert.throws(() => parseArgs(["--server", "--once"]), ConfigError, /needs a value/, "a flag is never a value");
assert.throws(() => parseArgs(["--key"]), ConfigError, /needs a value/);
assert.throws(() => parseArgs(["--name", "x"]), ConfigError, /must follow a --server/);
assert.throws(() => parseArgs(["--interval", "abc"]), ConfigError, /duration/);
assert.throws(() => parseArgs(["--theme", "neon"]), ConfigError, /dark or light/);
assert.throws(() => parseArgs(["--bogus"]), ConfigError, /unknown option/);

// ---- live mode watches --server, not the config file on disk ----
// start() is driven with a pre-resolved config, and stdout stays captured for
// the rest of the run so the frames it draws — including the one its rejected
// poll draws after start() returns — never land in the test output. stop()
// clears the animation clock and the poll timers.
const app = require("../strata-cli/app.js");
const liveCfg = cliConfig(parseArgs(["--server", "http://127.0.0.1:9", "--name", "Cli"]));
const frames = [];
const realWrite = process.stdout.write.bind(process.stdout);
const realExit = process.exit;
process.stdout.write = (chunk) => { frames.push(String(chunk)); return true; };
process.exit = () => {};
try {
  const handle = app.start({ color: "never", config: liveCfg });
  assert.equal(handle.cfg, liveCfg, "start() uses the given config instead of re-reading the file");
  assert.deepEqual(handle.entries.map((e) => e.server.name), ["Cli"], "--server is what the live view watches");
  assert.ok(frames.join("").includes("Cli"), "the frame shows the CLI server");
  assert.ok(frames[0].endsWith("\x1b[0J"), "a frame erases the leftover rows below it");
  assert.ok(frames[0].includes("\x1b[H"), "a frame starts at the top-left instead of clearing the screen");
  handle.stop();
} finally {
  process.exit = realExit;
}
fs.rmSync(dir, { recursive: true, force: true });
realWrite("config resolution, credential precedence, refresh clamping, permission warnings, CLI flags and live wiring OK\n");
