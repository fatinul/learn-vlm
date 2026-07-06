const config = require('../config');
const gpuStats = require('./gpuStats');

const state = {
  ollamaModel: config.ollamaModel,
  evalIntervalMs: config.evalIntervalMs,
  gpuStatsSource: config.gpuStatsSource,
};

function get() {
  return { ...state };
}

function setOllamaModel(model) {
  if (!model || typeof model !== 'string') {
    throw new Error('model must be a non-empty string');
  }
  state.ollamaModel = model;
  return state.ollamaModel;
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

module.exports = { get, setOllamaModel, setEvalIntervalMs, setGpuStatsSource };
