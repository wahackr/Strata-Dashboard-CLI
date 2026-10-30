// Polling, ported from the widget's main process: GET /metrics then GET /health,
// Bearer auth, per-request timeout, and a payload the view can render blindly.
// Fetching here (never in a browser context) is why the server's missing CORS
// headers do not matter.
const DEFAULT_TIMEOUT_MS = 4000;
const HEALTH_TIMEOUT_MS = 6000;

async function request(server, pathname, { timeout = DEFAULT_TIMEOUT_MS, apiKey = server.apiKey, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetchImpl(`${server.url}/${pathname}`, { headers, signal: ctrl.signal });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      // Enough evidence to debug a 401 without printing the key.
      const error = res.status === 401
        ? `401 unauthorized (Authorization ${apiKey ? "sent" : "missing"})`
        : `HTTP ${res.status}`;
      return { status: res.status, error, latencyMs };
    }
    return { status: res.status, body: await res.json(), latencyMs };
  } catch (e) {
    return {
      status: 0,
      error: e.name === "AbortError" ? "timeout" : String(e.message || e),
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

// One poll of one server. Shape matches the widget's lastPayload so renderer
// logic can be shared: { ok, status, error, metrics, health, auth }.
// The injected fetchImpl is threaded through to request() rather than swapped
// onto globalThis, so a stubbed poll can never leak into an unrelated request.
async function poll(server, { fetchImpl = fetch } = {}) {
  const m = await request(server, "metrics", {
    timeout: server.timeoutMs ?? DEFAULT_TIMEOUT_MS, fetchImpl,
  });
  if (m.status !== 200) {
    return {
      ok: false, status: m.status, error: m.error || `HTTP ${m.status}`,
      metrics: null, health: null, auth: Boolean(server.apiKey),
      latencyMs: m.latencyMs, at: Date.now(),
    };
  }
  const h = await request(server, "health", { timeout: HEALTH_TIMEOUT_MS, fetchImpl });
  return {
    ok: true, status: 200, error: null,
    metrics: m.body, health: h.status === 200 ? h.body : null,
    auth: Boolean(server.apiKey), latencyMs: m.latencyMs, at: Date.now(),
  };
}

// Which tray/CSS state this payload maps to: queued outranks live.state, and a
// failed poll is error. Same precedence as main.js trayStateFor().
function stateOf(payload) {
  if (!payload || !payload.ok) return "error";
  const live = payload.metrics?.live || {};
  if (Number(live.queued) > 0) return "queued";
  return live.state || "idle";
}

// Guards overlapping polls. The widget's setInterval fires on a fixed cadence
// with no in-flight check, so a slow server queues a growing pile of fetches;
// here a tick that is still running is simply skipped.
class Poller {
  constructor(server, { onPoll, fetchImpl = fetch } = {}) {
    this.server = server;
    this.onPoll = onPoll;
    this.fetchImpl = fetchImpl;
    this.payload = null;
    this.inFlight = false;
    this.timer = null;
  }

  async tick() {
    if (this.inFlight) return null;
    this.inFlight = true;
    try {
      this.payload = await poll(this.server, { fetchImpl: this.fetchImpl });
    } finally {
      this.inFlight = false;
    }
    this.onPoll?.(this.payload);
    return this.payload;
  }

  start() {
    this.stop();
    this.timer = setInterval(() => { this.tick(); }, this.server.refreshMs);
    this.tick();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = { request, poll, stateOf, Poller, DEFAULT_TIMEOUT_MS, HEALTH_TIMEOUT_MS };
