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
  const gpuPct = gpu.available && gpu.gpus[0] ? gpu.gpus[0].utilizationGpuPct : null;
  const gpuMemPct = gpu.available && gpu.gpus[0] ? gpu.gpus[0].memoryUsedMB : null;

  const timings = systemStats.getPipelineTimings();

  points.push({
    t: Date.now(),
    ramPct,
    gpuMemPct,
    cycleMs: timings.lastCycleMs,
    avgEvalMs: timings.avgEvaluationMs,
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
