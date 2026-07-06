const os = require('os');

/**
 * Tracks running counters for the agentic pipeline (frame freshness + AI
 * evaluation) and combines them with live OS metrics so the UI can show
 * the user how close the system is to its practical limits.
 */
const metrics = {
  framesUsed: 0,
  frameErrors: 0,
  totalFrameAgeMs: 0,
  lastFrameAgeMs: null,
  evaluationsOk: 0,
  evaluationsFailed: 0,
  totalEvaluationMs: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  tokensByModel: {},
  cycles: 0,
  totalCycleMs: 0,
  lastCycleMs: null,
  startedAt: new Date().toISOString(),
};

// How stale the frame was (time between when ffmpeg decoded it and when the
// evaluator picked it up) at the moment it was handed off for evaluation.
function recordFrameUse(frameAgeMs) {
  metrics.framesUsed += 1;
  metrics.totalFrameAgeMs += frameAgeMs;
  metrics.lastFrameAgeMs = frameAgeMs;
}

function recordFrameError() {
  metrics.frameErrors += 1;
}

function recordEvaluation(durationMs, ok) {
  metrics.totalEvaluationMs += durationMs;
  if (ok) metrics.evaluationsOk += 1;
  else metrics.evaluationsFailed += 1;
}

function recordTokens(promptTokens, completionTokens, model) {
  if (promptTokens != null) metrics.totalPromptTokens += promptTokens;
  if (completionTokens != null) metrics.totalCompletionTokens += completionTokens;
  const total = (promptTokens ?? 0) + (completionTokens ?? 0);
  if (total) {
    metrics.totalTokens += total;
    if (model) {
      metrics.tokensByModel[model] = (metrics.tokensByModel[model] || 0) + total;
    }
  }
}

function getTokensByModel() {
  return { ...metrics.tokensByModel };
}

function recordCycle(durationMs) {
  metrics.cycles += 1;
  metrics.totalCycleMs += durationMs;
  metrics.lastCycleMs = durationMs;
}

// Lightweight getter used by metricsHistory.js for trend sampling - avoids
// needing all the extra params snapshot() takes just to read two numbers.
function getPipelineTimings() {
  const totalEvaluations = metrics.evaluationsOk + metrics.evaluationsFailed;
  return {
    avgEvaluationMs: totalEvaluations ? round(metrics.totalEvaluationMs / totalEvaluations) : null,
    lastCycleMs: metrics.lastCycleMs,
  };
}

function snapshot({ checklistCount, evalIntervalMs, provider, model, running, gpu, rtsp } = {}) {
  const avgFrameAgeMs = metrics.framesUsed ? metrics.totalFrameAgeMs / metrics.framesUsed : null;
  const totalEvaluations = metrics.evaluationsOk + metrics.evaluationsFailed;
  const avgEvaluationMs = totalEvaluations ? metrics.totalEvaluationMs / totalEvaluations : null;
  const avgCycleMs = metrics.cycles ? metrics.totalCycleMs / metrics.cycles : null;

  const cpus = os.cpus();
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const processMem = process.memoryUsage();

  // Frame retrieval itself is now just a memory read (near-zero cost) since
  // ffmpeg keeps the newest frame continuously ready; the real per-cycle
  // cost is running the checklist through the model.
  const estimatedCycleMs = avgEvaluationMs != null && checklistCount
    ? avgEvaluationMs * checklistCount
    : null;

  const isOverloaded = estimatedCycleMs != null && evalIntervalMs != null
    ? estimatedCycleMs > evalIntervalMs
    : false;

  const avgTokensPerEval = totalEvaluations ? metrics.totalTokens / totalEvaluations : null;

  return {
    system: {
      platform: os.platform(),
      cpuModel: cpus[0] ? cpus[0].model : 'unknown',
      cpuCores: cpus.length,
      loadAvg1m: loadAvg[0],
      totalMemGB: round2(totalMem / 1024 ** 3),
      usedMemGB: round2(usedMem / 1024 ** 3),
      memUsagePct: round2((usedMem / totalMem) * 100),
      uptimeSec: Math.round(os.uptime()),
    },
    process: {
      rssMB: round2(processMem.rss / 1024 ** 2),
      heapUsedMB: round2(processMem.heapUsed / 1024 ** 2),
      pid: process.pid,
      nodeVersion: process.version,
      startedAt: metrics.startedAt,
    },
    pipeline: {
      running: !!running,
      provider,
      model,
      evalIntervalMs,
      checklistCount: checklistCount || 0,
      framesUsed: metrics.framesUsed,
      frameErrors: metrics.frameErrors,
      avgFrameAgeMs: round(avgFrameAgeMs),
      lastFrameAgeMs: round(metrics.lastFrameAgeMs),
      evaluationsOk: metrics.evaluationsOk,
      evaluationsFailed: metrics.evaluationsFailed,
      avgEvaluationMs: round(avgEvaluationMs),
      avgCycleMs: round(avgCycleMs),
      lastCycleMs: round(metrics.lastCycleMs),
      estimatedCycleMs: round(estimatedCycleMs),
      isOverloaded,
      totalPromptTokens: metrics.totalPromptTokens,
      totalCompletionTokens: metrics.totalCompletionTokens,
      totalTokens: metrics.totalTokens,
      avgTokensPerEval: round(avgTokensPerEval),
    },
    gpu: gpu || { available: false, gpus: [], lastError: 'not polled', lastUpdated: null },
    rtsp: rtsp || { connected: false, hasFrame: false, lastFrameAt: null, frameAgeMs: null, restartCount: 0, lastError: null },
  };
}

function round(v) {
  return v == null ? null : Math.round(v);
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

module.exports = {
  recordFrameUse,
  recordFrameError,
  recordEvaluation,
  recordTokens,
  getTokensByModel,
  recordCycle,
  getPipelineTimings,
  snapshot,
};
