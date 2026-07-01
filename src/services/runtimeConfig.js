const config = require('../config');

/**
 * Settings that can be changed from the UI at runtime, without restarting
 * the server. Everything else in config.js (ports, RTSP URL, etc.) still
 * requires a restart since changing them mid-flight is far riskier.
 */
const state = {
  ollamaModel: config.ollamaModel,
  evalIntervalMs: config.evalIntervalMs,
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

module.exports = { get, setOllamaModel, setEvalIntervalMs };
