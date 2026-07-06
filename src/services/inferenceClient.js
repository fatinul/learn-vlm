const groqClient = require('./groqClient');
const ollamaClient = require('./ollamaClient');
const runtimeConfig = require('./runtimeConfig');

function getClient() {
  return runtimeConfig.get().provider === 'groq' ? groqClient : ollamaClient;
}

function buildPrompt(condition) {
  return getClient().buildPrompt(condition);
}

function askYesNo(args) {
  return getClient().askYesNo(args);
}

module.exports = { buildPrompt, askYesNo };
