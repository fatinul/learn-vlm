const { exec } = require('child_process');

/**
 * Polls `nvidia-smi` on a background interval (rather than per-request) so
 * that reading GPU stats doesn't add latency/spawn overhead to the polled
 * /api/state endpoint. Falls back gracefully when no NVIDIA GPU/driver is
 * present (e.g. AMD/Intel-only machines) - the rest of the app keeps working.
 */
const FIELDS = [
  'name',
  'utilization.gpu',
  'utilization.memory',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'power.draw',
];

let cache = {
  available: false,
  gpus: [],
  lastError: 'not polled yet',
  lastUpdated: null,
};
let pollTimer = null;

function pollOnce() {
  return new Promise((resolve) => {
    const cmd = `nvidia-smi --query-gpu=${FIELDS.join(',')} --format=csv,noheader,nounits`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        cache = {
          available: false,
          gpus: [],
          lastError: /not recognized|not found|ENOENT/i.test(err.message)
            ? 'nvidia-smi not found (no NVIDIA GPU/driver detected)'
            : err.message,
          lastUpdated: new Date().toISOString(),
        };
        resolve(cache);
        return;
      }

      const gpus = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          const parts = line.split(',').map((p) => p.trim());
          return {
            index,
            name: parts[0],
            utilizationGpuPct: toNumber(parts[1]),
            utilizationMemPct: toNumber(parts[2]),
            memoryUsedMB: toNumber(parts[3]),
            memoryTotalMB: toNumber(parts[4]),
            temperatureC: toNumber(parts[5]),
            powerDrawW: toNumber(parts[6]),
          };
        });

      cache = { available: true, gpus, lastError: null, lastUpdated: new Date().toISOString() };
      resolve(cache);
    });
  });
}

function toNumber(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function start(intervalMs = 2000) {
  if (pollTimer) return;
  pollOnce();
  pollTimer = setInterval(pollOnce, intervalMs);
  if (pollTimer.unref) pollTimer.unref();
}

function stop() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function snapshot() {
  return cache;
}

module.exports = { start, stop, snapshot };
