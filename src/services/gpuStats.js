const { exec } = require('child_process');

const NV_FIELDS = [
  'name',
  'utilization.gpu',
  'utilization.memory',
  'memory.used',
  'memory.total',
  'temperature.gpu',
  'power.draw',
];

let source = 'nvidia-smi';
let cache = {
  available: false,
  source: 'nvidia-smi',
  gpus: [],
  lastError: 'not polled yet',
  lastUpdated: null,
};
let pollTimer = null;

function setSource(newSource) {
  if (newSource !== 'nvidia-smi' && newSource !== 'tegrastats') {
    throw new Error(`Unknown GPU stats source: ${newSource}`);
  }
  const changed = newSource !== source;
  source = newSource;
  if (changed) {
    stop();
    cache = {
      available: false,
      source,
      gpus: [],
      lastError: 'not polled yet',
      lastUpdated: null,
    };
    start();
  }
  return changed;
}

function pollOnce() {
  if (source === 'tegrastats') {
    return pollTegrastats();
  }
  return pollNvidiaSmi();
}

function pollNvidiaSmi() {
  return new Promise((resolve) => {
    const cmd = `nvidia-smi --query-gpu=${NV_FIELDS.join(',')} --format=csv,noheader,nounits`;
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        cache = {
          available: false,
          source: 'nvidia-smi',
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

      cache = { available: true, source: 'nvidia-smi', gpus, lastError: null, lastUpdated: new Date().toISOString() };
      resolve(cache);
    });
  });
}

function pollTegrastats() {
  return new Promise((resolve) => {
    exec('tegrastats 2>&1', { timeout: 2500 }, (err, stdout) => {
      if (err && err.code === 'ENOENT') {
        cache = {
          available: false,
          source: 'tegrastats',
          gpus: [],
          lastError: 'tegrastats not found (not a Jetson platform)',
          lastUpdated: new Date().toISOString(),
        };
        resolve(cache);
        return;
      }
      const lines = (stdout || '').trim().split('\n').filter(Boolean);
      const last = lines[lines.length - 1] || '';
      cache = parseTegrastatsLine(last);
      resolve(cache);
    });
  });
}

function parseTegrastatsLine(line) {
  if (!line) {
    return {
      available: false,
      source: 'tegrastats',
      gpus: [],
      lastError: 'empty tegrastats output',
      lastUpdated: new Date().toISOString(),
    };
  }

  const result = {
    available: true,
    source: 'tegrastats',
    lastError: null,
    lastUpdated: new Date().toISOString(),
    timestamp: null,
    ram: { usedMB: null, totalMB: null },
    swap: { usedMB: null, totalMB: null, cachedMB: null },
    cpus: [],
    emcFreq: { pct: null, freqMHz: null },
    gr3dFreq: { pct: null, freqMHz: null },
    engines: {},
    ape: null,
    temperatures: {},
    power: {},
  };

  const ramMatch = line.match(/RAM\s+(\d+)\/(\d+)MB/);
  if (ramMatch) {
    result.ram.usedMB = parseInt(ramMatch[1], 10);
    result.ram.totalMB = parseInt(ramMatch[2], 10);
  }

  const swapMatch = line.match(/SWAP\s+(\d+)\/(\d+)MB\s+\(cached\s+(\d+)MB\)/);
  if (swapMatch) {
    result.swap.usedMB = parseInt(swapMatch[1], 10);
    result.swap.totalMB = parseInt(swapMatch[2], 10);
    result.swap.cachedMB = parseInt(swapMatch[3], 10);
  }

  const cpuMatch = line.match(/CPU\s+\[([^\]]+)\]/);
  if (cpuMatch) {
    result.cpus = cpuMatch[1].split(',').map((s) => {
      const parts = s.trim().match(/(\d+)%@(\d+)/);
      return parts
        ? { pct: parseInt(parts[1], 10), freqMHz: parseInt(parts[2], 10) }
        : { pct: null, freqMHz: null };
    });
  }

  const emcMatch = line.match(/EMC_FREQ\s+(\d+)%@(\d+)/);
  if (emcMatch) {
    result.emcFreq.pct = parseInt(emcMatch[1], 10);
    result.emcFreq.freqMHz = parseInt(emcMatch[2], 10);
  }

  const gr3dMatch = line.match(/GR3D_FREQ\s+(\d+)%@\[?(\d+)\]?/);
  if (gr3dMatch) {
    result.gr3dFreq.pct = parseInt(gr3dMatch[1], 10);
    result.gr3dFreq.freqMHz = parseInt(gr3dMatch[2], 10);
  }

  const engineNames = ['NVENC', 'NVDEC', 'NVJPG', 'NVJPG1', 'VIC', 'OFA', 'NVDLA0', 'NVDLA1', 'PVA0_FREQ'];
  for (const name of engineNames) {
    const enMatch = line.match(new RegExp(`${name}\\s+(off|\\d+)`));
    if (enMatch) {
      result.engines[name] = enMatch[1] === 'off' ? false : parseInt(enMatch[1], 10);
    }
  }

  const apeMatch = line.match(/\bAPE\s+(\d+)/);
  if (apeMatch) {
    result.ape = parseInt(apeMatch[1], 10);
  }

  const tempMatches = line.matchAll(/(\w+)@([\d.]+)C/g);
  for (const m of tempMatches) {
    result.temperatures[m[1]] = parseFloat(m[2]);
  }

  const powerMatches = line.matchAll(/(\w+(?:_\w+)?)\s+(\d+)mW\/(\d+)mW/g);
  for (const m of powerMatches) {
    const key = m[1].replace(/-/g, '_');
    result.power[key] = {
      currentMW: parseInt(m[2], 10),
      averageMW: parseInt(m[3], 10),
    };
  }

  const tsMatch = line.match(/^(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/);
  if (tsMatch) {
    result.timestamp = tsMatch[1];
  }

  return result;
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
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function snapshot() {
  return cache;
}

module.exports = { start, stop, snapshot, setSource };
