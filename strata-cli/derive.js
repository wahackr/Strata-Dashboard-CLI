// Derives every number the view draws, ported from renderer/renderer.js so the
// terminal reports the same values as the widget for the same payload.
const f = require("./format.js");
const { stateOf } = require("./client.js");

const BADGE = {
  stop: ["done", "Done"], length: ["done", "Max tokens"], cancel: ["warn", "Stopped"],
  disconnect: ["warn", "Closed"], error: ["bad", "Error"],
};

const EMPTY = {
  state: "idle", label: "Connecting…", detail: "", pct: 0,
  speed: null, prefill: null, speedSub: "decode", gpu: null, gpuSub: "",
  vramUsed: null, vramTotal: null, vramSub: "", temp: null, tempSub: "",
  power: null, powerLimit: null, pcie: null, pcieSub: "", cpu: null, cpuSub: "",
  disk: null, diskSub: "", ctxFrac: 0, ctxUsed: 0, ctxMax: 0,
  cache: "–", cacheFrac: 0, ram: "–", ramFrac: 0,
  lastRequest: "", requestsKept: 0, model: "–", history: {},
};

function derive(payload) {
  const d = { ...EMPTY, history: {} };
  if (!payload || !payload.ok) {
    const is401 = payload?.status === 401;
    return {
      ...d, state: "error",
      label: is401 ? "API key needed" : "Server not reachable",
      detail: is401 ? "set apiKey / apiKeyEnv for this server" : (payload?.error || ""),
    };
  }

  const m = payload.metrics || {};
  const live = m.live || {}, hw = m.hardware || {}, st = m.hardware_static || {};
  const eng = m.engine || {}, h = m.history || {};
  const requests = m.requests || [];
  const last = requests[0];
  d.state = stateOf(payload);
  d.history = h;
  d.model = payload.health?.model || eng.model || "–";

  let label = "Waiting for a request", detail = "", pct = 0;
  if (live.state === "reading") {
    label = "Reading prompt";
    if (live.prompt_total) {
      pct = (100 * live.prompt_read) / live.prompt_total;
      detail = `${f.kfmt(live.prompt_read)} / ${f.kfmt(live.prompt_total)} tokens · ${f.fmt(pct)}%`;
    } else detail = `${f.kfmt(live.prompt_tokens)} tokens`;
  } else if (live.state === "generating") {
    label = live.phase ? live.phase[0].toUpperCase() + live.phase.slice(1) : "Generating";
    pct = live.max_tokens ? Math.min(100, (100 * live.generated) / live.max_tokens) : 0;
    detail = `${f.kfmt(live.generated)} tokens · ${f.fmt(live.tok_s, 1)} tok/s`;
  } else if (last) {
    detail = `last: ${f.kfmt(last.output_tokens)} tokens${last.decode_tok_s ? ` at ${f.fmt(last.decode_tok_s, 1)} tok/s` : ""}`;
  }
  d.label = label; d.detail = detail; d.pct = pct;

  // Speed card: decode now (or last), prefill alongside — same pairing as the widget.
  d.speed = live.state === "generating" ? live.tok_s : last ? last.decode_tok_s : null;
  d.prefill = live.state !== "idle" ? live.prefill_tok_s_mean
    : last && last.prompt_ms > 0 ? Math.max(0, last.prompt_tokens - (last.reused || 0)) / (last.prompt_ms / 1000) : null;
  d.speedSub = live.state === "generating" ? "decode now"
    : live.state === "reading" ? "prefill now" : last ? "decode last" : "decode";

  const gpus = hw.gpus || [];
  const multi = gpus.length > 1;
  const per = (fn) => gpus.map((g) => `GPU ${g.index} ${fn(g)}`).join(" · ");

  d.gpu = hw.gpu_util == null ? null : f.fmt(hw.gpu_util);
  d.gpuSub = multi ? per((g) => (g.util == null ? "–" : `${f.fmt(g.util)}%`))
    : st.gpu_name || (st.gpu_note ? "not available" : "");

  d.vramUsed = hw.gpu_mem_used == null ? null : f.gb(hw.gpu_mem_used);
  d.vramTotal = hw.gpu_mem_total == null ? null : f.gb(hw.gpu_mem_total, 0);
  d.vramSub = multi ? per((g) => (g.mem_used == null ? "–" : `${f.gb(g.mem_used)} GB`))
    : eng.expert_slots ? `${f.kfmt(eng.expert_slots)} experts cached` : (st.gpu_note || "");

  d.temp = hw.gpu_temp == null ? null : f.fmt(hw.gpu_temp);
  d.tempSub = multi ? per((g) => (g.temp == null ? "–" : `${f.fmt(g.temp)}°`)) : "";

  d.power = hw.gpu_power == null ? null : f.fmt(hw.gpu_power);
  d.powerLimit = hw.gpu_power_limit == null ? null : f.fmt(hw.gpu_power_limit);

  const gen = hw.gpu_pcie_gen_max || hw.gpu_pcie_gen;
  d.pcie = gen ? `Gen${gen}` : null;
  d.pcieSub = hw.gpu_pcie_width ? `x${hw.gpu_pcie_width}` : "";
  if (hw.gpu_pcie_rx_mb != null) {
    d.pcieSub += ` · ${f.fmt(hw.gpu_pcie_rx_mb, hw.gpu_pcie_rx_mb < 10 ? 1 : 0)} MB/s to GPU`;
    if (hw.gpu_pcie_gen && gen && hw.gpu_pcie_gen < gen) d.pcieSub += ` (idle Gen${hw.gpu_pcie_gen})`;
  }

  d.cpu = hw.cpu == null ? null : f.fmt(hw.cpu);
  d.cpuSub = st.threads ? `${st.cores ? `${st.cores} cores · ` : ""}${st.threads} threads` : "";

  if (hw.disk_read_mb == null) {
    d.disk = null; d.diskSub = st.psutil ? "" : "needs psutil";
  } else {
    const big = hw.disk_read_mb >= 1000;
    d.disk = big ? f.fmt(hw.disk_read_mb / 1024, 2) : f.fmt(hw.disk_read_mb, hw.disk_read_mb < 10 ? 1 : 0);
    d.diskSub = (big ? "GB/s" : "MB/s") + (hw.disk_write_mb == null ? "" : ` · write ${f.fmt(hw.disk_write_mb, 1)} MB/s`);
  }

  const ctx = eng.max_context || 0;
  let used = 0;
  if (live.state !== "idle") used = (live.prompt_tokens || 0) + (live.generated || 0);
  else if (last) used = (last.prompt_tokens || 0) + (last.output_tokens || 0);
  d.ctxMax = ctx; d.ctxUsed = used;
  d.ctxFrac = ctx ? Math.min(1, used / ctx) : 0;

  const cacheBytes = (eng.expert_cache_mib || 0) * 1048576;
  d.cache = eng.expert_slots ? `${f.kfmt(eng.expert_slots)} experts · ${f.gb(cacheBytes)} GB` : "–";
  d.cacheFrac = hw.gpu_mem_total ? Math.min(1, cacheBytes / hw.gpu_mem_total) : 0;

  d.ram = hw.ram_total ? `${f.gb(hw.ram_used)} / ${f.gb(hw.ram_total, 0)} GB` : "–";
  d.ramFrac = hw.ram_total ? hw.ram_used / hw.ram_total : 0;

  d.requestsKept = m.requests_kept || 0;
  const b = last ? (BADGE[last.finish] || ["done", last.finish || "done"]) : null;
  d.lastRequest = last
    ? `${f.time(last.time)}  ${b[1]} · ${f.kfmt(last.prompt_tokens)} in / ${f.kfmt(last.reused)} reused / `
      + `${f.kfmt(last.output_tokens)} out · ${f.fmt(last.decode_tok_s, 1)} t/s`
    : "";
  d.badgeKind = b ? b[0] : "done";
  return d;
}

module.exports = { derive, BADGE };
