const os = require('os');
const gpuStats = require('./gpuStats');
const systemStats = require('./systemStats');

/**
 * Keeps a short rolling time-series of a few key numbers (RAM usage, GPU
 * usage, cycle time, avg AI evaluation time) so the UI can render trend
 * graphs. Sampled on its own timer, independent of how often the browser
 * polls the API.
 */
const MAX_POINTS = 40;
const SAMPLE_INTERVAL_MS = 3000;

let points = [];
let timer = null;

function sampleOnce() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ramPct = round2(((totalMem - freeMem) / totalMem) * 100);

  const gpu = gpuStats.snapshot();
  let gpuPct = null;
  let gpuMemMB = null;
  if (gpu.available) {
    if (gpu.source === 'tegrastats') {
      gpuPct = gpu.gr3dFreq ? gpu.gr3dFreq.pct : null;
      gpuMemMB = gpu.ram ? gpu.ram.usedMB : null;
    } else if (gpu.gpus && gpu.gpus[0]) {
      gpuPct = gpu.gpus[0].utilizationGpuPct;
      gpuMemMB = gpu.gpus[0].memoryUsedMB;
    }
  }

  const timings = systemStats.getPipelineTimings();

  points.push({
    t: Date.now(),
    ramPct,
    gpuMemPct: gpuMemMB,
    cycleMs: timings.lastCycleMs,
    avgEvalMs: timings.avgEvaluationMs,
    tokensByModel: systemStats.getTokensByModel(),
  });

  if (points.length > MAX_POINTS) {
    points.shift();
  }
}

function start() {
  if (timer) return;
  sampleOnce();
  timer = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

function list() {
  return points;
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

module.exports = { start, stop, list };
