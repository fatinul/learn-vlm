const express = require('express');
const checklistStore = require('../services/checklistStore');
const evaluator = require('../services/evaluator');
const systemStats = require('../services/systemStats');
const gpuStats = require('../services/gpuStats');
const rtspCapture = require('../services/rtspCapture');
const inferenceLog = require('../services/inferenceLog');
const metricsHistory = require('../services/metricsHistory');
const runtimeConfig = require('../services/runtimeConfig');
const config = require('../config');

const router = express.Router();

// Single combined endpoint the front-end polls: current frame, checklist
// results, pipeline status, and system statistics.
router.get('/state', (req, res) => {
  const evalState = evaluator.getState();
  const checklist = checklistStore.list();
  const settings = runtimeConfig.get();
  const stats = systemStats.snapshot({
    checklistCount: checklist.length,
    evalIntervalMs: settings.evalIntervalMs,
    ollamaModel: settings.ollamaModel,
    running: evalState.running,
    gpu: gpuStats.snapshot(),
    rtsp: rtspCapture.getStatus(),
  });

  res.json({
    frame: evalState.latestFrame,
    running: evalState.running,
    busy: evalState.busy,
    lastError: evalState.lastError,
    currentActivity: evalState.currentActivity,
    checklist,
    stats,
  });
});

// Recent prompt/response history, so a developer can see exactly what was
// sent to the model and what it answered for each evaluated condition.
router.get('/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  res.json({ logs: inferenceLog.list(limit) });
});

// Short rolling time-series for the trend graphs (RAM/GPU/cycle/eval time).
router.get('/history', (req, res) => {
  res.json({ points: metricsHistory.list() });
});

router.post('/checklist', (req, res) => {
  const prompt = (req.body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  const item = checklistStore.add(prompt);
  res.status(201).json(item);
});

// Editing a condition's text resets its status back to "pending" - the
// tickbox itself is still only ever set by the AI evaluator.
router.put('/checklist/:id', (req, res) => {
  const prompt = (req.body.prompt || '').trim();
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  const item = checklistStore.rename(req.params.id, prompt);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

router.delete('/checklist/:id', (req, res) => {
  const ok = checklistStore.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
});

router.post('/control/start', (req, res) => {
  evaluator.start();
  res.json({ running: true });
});

router.post('/control/stop', (req, res) => {
  evaluator.stop();
  res.json({ running: false });
});

router.post('/control/evaluate-now', (req, res) => {
  evaluator.evaluateNow().catch(() => {});
  res.json({ triggered: true });
});

// Lists models available on the configured Ollama host, so the UI can offer
// a dropdown instead of requiring an .env edit + restart.
router.get('/models', async (req, res) => {
  try {
    const response = await fetch(`${config.ollamaHost}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama responded with ${response.status}`);
    }
    const data = await response.json();
    const models = (data.models || []).map((m) => ({
      name: m.name,
      vision: Array.isArray(m.capabilities) && m.capabilities.includes('vision'),
      capabilities: m.capabilities || [],
      parameterSize: m.details ? m.details.parameter_size : null,
    }));
    // Vision-capable models first, since this app only usefully works with those.
    models.sort((a, b) => Number(b.vision) - Number(a.vision) || a.name.localeCompare(b.name));
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: `Could not reach Ollama at ${config.ollamaHost}: ${err.message}` });
  }
});

router.get('/settings', (req, res) => {
  res.json({ ...runtimeConfig.get(), ollamaHost: config.ollamaHost });
});

router.post('/settings', (req, res) => {
  try {
    if (req.body.model !== undefined) {
      runtimeConfig.setOllamaModel(req.body.model);
    }
    if (req.body.evalIntervalMs !== undefined) {
      runtimeConfig.setEvalIntervalMs(req.body.evalIntervalMs);
    }
    if (req.body.gpuStatsSource !== undefined) {
      runtimeConfig.setGpuStatsSource(req.body.gpuStatsSource);
    }
    if (req.body.rtspUrl !== undefined) {
      runtimeConfig.setRtspUrl(req.body.rtspUrl);
    }
    res.json({ ...runtimeConfig.get() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
