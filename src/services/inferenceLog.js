const { randomUUID } = require('crypto');

/**
 * Rolling in-memory log of every prompt sent to the model and the raw
 * response received, so a developer can see exactly what the AI was asked
 * and what it answered for each checklist condition/frame.
 */
const MAX_ENTRIES = 50;
let entries = [];

function add(entry) {
  const record = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  entries.unshift(record);
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
  return record;
}

function list(limit) {
  return typeof limit === 'number' ? entries.slice(0, limit) : entries;
}

function clear() {
  entries = [];
}

module.exports = { add, list, clear };
