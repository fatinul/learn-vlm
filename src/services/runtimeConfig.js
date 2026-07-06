const config = require('../config');
const gpuStats = require('./gpuStats');
const rtspCapture = require('./rtspCapture');

const state = {
  provider: config.inferenceProvider,
  groqModel: config.groqModel,
  ollamaModel: config.ollamaModel,
  evalIntervalMs: config.evalIntervalMs,
  gpuStatsSource: config.gpuStatsSource,
  rtspUrl: config.rtspUrl,
};

function activeModel() {
  return state.provider === 'groq' ? state.groqModel : state.ollamaModel;
}

function get() {
  return {
    provider: state.provider,
    model: activeModel(),
    groqModel: state.groqModel,
    ollamaModel: state.ollamaModel,
    evalIntervalMs: state.evalIntervalMs,
    gpuStatsSource: state.gpuStatsSource,
    rtspUrl: state.rtspUrl,
  };
}

function setProvider(provider) {
  if (provider !== 'groq' && provider !== 'ollama') {
    throw new Error('provider must be "groq" or "ollama"');
  }
  state.provider = provider;
  return get();
}

function setModel(model) {
  if (!model || typeof model !== 'string') {
    throw new Error('model must be a non-empty string');
  }
  if (state.provider === 'groq') {
    state.groqModel = model;
  } else {
    state.ollamaModel = model;
  }
  return activeModel();
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

module.exports = {
  get,
  setProvider,
  setModel,
  setEvalIntervalMs,
  setGpuStatsSource,
  setRtspUrl,
};
