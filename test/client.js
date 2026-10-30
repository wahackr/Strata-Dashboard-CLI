// Polling: URL joining, Bearer auth, failure shapes, and the guard that keeps
// a slow server from queueing fetches. Run: node test/client.js
const assert = require("node:assert/strict");
const { request, poll, stateOf, Poller } = require("../strata-cli/client.js");

const server = { id: "srv-1", name: "Home", url: "http://127.0.0.1:8080", apiKey: "k1", refreshMs: 250, timeoutMs: 200 };

// Enough of a Response for what request() reads: ok, status, json().
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const seen = [];
const routes = (map) => async (url, opts) => {
  seen.push({ url, headers: opts.headers });
  const hit = map[new URL(url).pathname];
  if (hit === undefined) return response(404, {});
  return response(200, hit);
};

const METRICS = { live: { state: "generating", queued: 0, tok_s: 41.2 }, engine: { max_context: 131072 }, requests: [] };

(async () => {
  // ---- URL joining and auth header, same as the widget's request() ----
  seen.length = 0;
  const r = await request(server, "metrics", { fetchImpl: routes({ "/metrics": METRICS }) });
  assert.equal(seen[0].url, "http://127.0.0.1:8080/metrics", "path appended to the base url");
  assert.equal(seen[0].headers.Authorization, "Bearer k1", "Bearer header sent");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, METRICS);
  assert.ok(r.latencyMs >= 0, "latency recorded");

  // No key means no Authorization header at all — Strata is open by default.
  seen.length = 0;
  await request({ ...server, apiKey: "" }, "health", { fetchImpl: routes({ "/health": { model: "m" } }) });
  assert.deepEqual(seen[0].headers, {}, "no header when there is no key");

  // ---- failure shapes ----
  const unauth = await request(server, "metrics", { fetchImpl: routes({}) });
  assert.equal(unauth.status, 404);
  assert.equal(unauth.error, "HTTP 404");
  const denied = await request(server, "metrics", { fetchImpl: async () => response(401, {}) });
  assert.match(denied.error, /401 unauthorized \(Authorization sent\)/, "401 says whether a key was sent");
  const deniedNoKey = await request({ ...server, apiKey: "" }, "metrics", { fetchImpl: async () => response(401, {}) });
  assert.match(deniedNoKey.error, /Authorization missing/, "401 without a key says the key was missing");

  // A hanging server is a timeout, not an unhandled rejection.
  const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => {
    const e = new Error("aborted"); e.name = "AbortError"; reject(e);
  }));
  const slow = await request(server, "metrics", { timeout: 40, fetchImpl: hang });
  assert.equal(slow.status, 0);
  assert.equal(slow.error, "timeout");

  // A server that throws mid-request is reported, not thrown out of poll().
  const broken = await poll({ ...server, apiKey: "" }, { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(broken.ok, false);
  assert.equal(broken.status, 0);
  assert.equal(broken.error, "ECONNREFUSED");
  assert.equal(stateOf(broken), "error");

  // ---- poll(): metrics then health ----
  const both = await poll(server, { fetchImpl: routes({ "/metrics": METRICS, "/health": { model: "qwen3.8" } }) });
  assert.equal(both.ok, true);
  assert.equal(both.metrics.live.state, "generating");
  assert.equal(both.health.model, "qwen3.8");
  assert.equal(both.auth, true, "auth flag reflects the key");
  assert.equal(stateOf(both), "generating");

  // A server without /health still renders: ok survives, health is null.
  const noHealth = await poll(server, { fetchImpl: routes({ "/metrics": METRICS }) });
  assert.equal(noHealth.ok, true);
  assert.equal(noHealth.health, null, "a missing health payload is not a failed poll");
  assert.equal(stateOf(noHealth), "generating");

  // A failed metrics call short-circuits; health is never requested.
  seen.length = 0;
  const failed = await poll(server, { fetchImpl: async () => response(503, {}) });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "HTTP 503");
  assert.deepEqual(seen.map((s) => s.url), ["http://127.0.0.1:8080/metrics"], "no health request after a failed metrics call");

  // ---- Poller: one in-flight poll at a time ----
  let calls = 0;
  let release;
  const gate = () => new Promise((resolve) => { release = resolve; calls += 1; });
  const poller = new Poller({ ...server, apiKey: "" }, {
    fetchImpl: async () => { await gate(); return response(200, METRICS); },
    onPoll: (p) => { poller.payload = p; },
  });
  const first = poller.tick();
  const second = await poller.tick();
  assert.equal(second, null, "a tick while one is in flight is skipped, not queued");
  assert.equal(calls, 1, "the slow server was asked once");
  release(response(200, METRICS));
  const done = await first;
  assert.equal(done.ok, true);
  assert.equal(poller.payload.ok, true, "onPoll saw the payload");
  assert.equal(calls, 1, "no extra fetch while the first was still running");

  // After it settles, the next tick goes through.
  await poller.tick();
  assert.equal(calls, 2, "the guard clears once the poll finishes");
  poller.stop();

  // start()/stop() leave no timer behind and poll immediately.
  let ticks = 0;
  const live = new Poller({ ...server, refreshMs: 100000 }, {
    fetchImpl: async () => { ticks += 1; return response(200, METRICS); },
  });
  live.start();
  assert.equal(ticks, 1, "start() polls at once instead of waiting a full interval");
  live.stop();
  live.start();
  live.stop();
  assert.equal(ticks, 2, "restart does not stack timers");

  console.log("url joining, bearer auth, failure shapes, health fallback and no-overlap polling OK");
})().catch((e) => { console.error(e.message); process.exit(1); });
