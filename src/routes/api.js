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
    model: settings.model,
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

const GROQ_VISION_MODELS = new Set([
  'qwen/qwen3.6-27b',
  'meta-llama/llama-4-scout-17b-16e-instruct',
]);

// Lists models available on Groq, so the UI can offer a dropdown.
router.get('/models', async (req, res) => {
  if (!config.groqApiKey) {
    return res.status(502).json({ error: 'GROQ_API_KEY is not configured' });
  }
  try {
    const response = await fetch(`${config.groqBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.groqApiKey}` },
    });
    if (!response.ok) {
      throw new Error(`Groq responded with ${response.status}`);
    }
    const data = await response.json();
    const models = (data.data || []).map((m) => ({
      name: m.id,
      vision: GROQ_VISION_MODELS.has(m.id),
      capabilities: GROQ_VISION_MODELS.has(m.id) ? ['vision'] : [],
      parameterSize: null,
    }));
    models.sort((a, b) => Number(b.vision) - Number(a.vision) || a.name.localeCompare(b.name));
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: `Could not reach Groq API: ${err.message}` });
  }
});

router.get('/settings', (req, res) => {
  res.json({ ...runtimeConfig.get(), groqConfigured: Boolean(config.groqApiKey) });
});

router.post('/settings', (req, res) => {
  try {
    if (req.body.model !== undefined) {
      runtimeConfig.setModel(req.body.model);
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
