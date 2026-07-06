const config = require('../config');
const gpuStats = require('./gpuStats');
const rtspCapture = require('./rtspCapture');

const state = {
  model: config.groqModel,
  evalIntervalMs: config.evalIntervalMs,
  gpuStatsSource: config.gpuStatsSource,
  rtspUrl: config.rtspUrl,
};

function get() {
  return { ...state };
}

function setModel(model) {
  if (!model || typeof model !== 'string') {
    throw new Error('model must be a non-empty string');
  }
  state.model = model;
  return state.model;
}

function setEvalIntervalMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 1000) {
    throw new Error('evalIntervalMs must be a number >= 1000');
  }
  state.evalIntervalMs = Math.round(value);
  return state.evalIntervalMs;
}

function setGpuStatsSource(src) {
  if (src !== 'nvidia-smi' && src !== 'tegrastats') {
    throw new Error('gpuStatsSource must be "nvidia-smi" or "tegrastats"');
  }
  state.gpuStatsSource = src;
  gpuStats.setSource(src);
  return state.gpuStatsSource;
}

function setRtspUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('rtspUrl must be a non-empty string');
  }
  state.rtspUrl = url;
  rtspCapture.changeSource(url);
  return state.rtspUrl;
}

module.exports = { get, setModel, setEvalIntervalMs, setGpuStatsSource, setRtspUrl };
