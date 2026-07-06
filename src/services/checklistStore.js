const { randomUUID } = require('crypto');

/**
 * In-memory checklist storage. Each item's status/confidence/reason fields
 * are only ever written by the evaluator - the API deliberately does not
 * expose a way to set them manually, so tickboxes stay AI-controlled.
 */
let items = [];

function list() {
  return items;
}

function add(prompt) {
  const item = {
    id: randomUUID(),
    prompt,
    status: 'pending', // pending | true | false | error
    confidence: null,
    reason: '',
    lastCheckedAt: null,
    lastLatencyMs: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  return item;
}

// Updates a condition's prompt text. Since the condition itself changed,
// any previous AI verdict is stale, so status resets to 'pending' until the
// next evaluation cycle re-checks it against the current frame.
function rename(id, prompt) {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  item.prompt = prompt;
  item.status = 'pending';
  item.confidence = null;
  item.reason = '';
  item.lastCheckedAt = null;
  item.lastLatencyMs = null;
  item.promptTokens = null;
  item.completionTokens = null;
  item.totalTokens = null;
  return item;
}

function remove(id) {
  const before = items.length;
  items = items.filter((item) => item.id !== id);
  return items.length !== before;
}

function update(id, patch) {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, patch);
  return item;
}

function get(id) {
  return items.find((i) => i.id === id) || null;
}

module.exports = { list, add, remove, update, get, rename };
