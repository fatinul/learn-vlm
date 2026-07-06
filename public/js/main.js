const POLL_MS = 2000;

const state = {
  running: true,
};

// Tracks which checklist item (if any) is currently being edited, so the
// periodic poll doesn't blow away the in-progress edit.
let editingId = null;
let lastChecklistItems = [];

// Tracks which activity-log entries the user has manually expanded, so
// re-rendering (every poll) doesn't collapse them again.
const expandedLogIds = new Set();
let lastLogsSignature = null;

let charts = null;

const el = {
  frame: document.getElementById('frame'),
  frameOverlay: document.getElementById('frameOverlay'),
  frameTimestamp: document.getElementById('frameTimestamp'),
  frameAge: document.getElementById('frameAge'),
  rtspStatus: document.getElementById('rtspStatus'),
  errorBanner: document.getElementById('errorBanner'),
  checklist: document.getElementById('checklist'),
  addForm: document.getElementById('addForm'),
  promptInput: document.getElementById('promptInput'),
  stats: document.getElementById('stats'),
  gpuStats: document.getElementById('gpuStats'),
  statusPill: document.getElementById('statusPill'),
  toggleBtn: document.getElementById('toggleBtn'),
  evalNowBtn: document.getElementById('evalNowBtn'),
  overloadWarning: document.getElementById('overloadWarning'),
  currentActivity: document.getElementById('currentActivity'),
  currentActivityCondition: document.getElementById('currentActivityCondition'),
  currentActivityPrompt: document.getElementById('currentActivityPrompt'),
  activityLog: document.getElementById('activityLog'),
  modelSelect: document.getElementById('modelSelect'),
  intervalInput: document.getElementById('intervalInput'),
  gpuSourceSelect: document.getElementById('gpuSourceSelect'),
  rtspUrlInput: document.getElementById('rtspUrlInput'),
  sourceUrlDisplay: document.getElementById('sourceUrlDisplay'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  settingsStatus: document.getElementById('settingsStatus'),
};

async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    el.statusPill.textContent = 'Disconnected';
    el.statusPill.className = 'pill pill-error';
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs?limit=20');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderActivityLog(data.logs);
  } catch (err) {
    // Non-critical: leave the last known log list in place.
  }
}

async function fetchHistory() {
  try {
    const res = await fetch('/api/history');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    updateCharts(data.points || []);
  } catch (err) {
    // Non-critical: leave the last known charts in place.
  }
}

function render(data) {
  state.running = data.running;

  if (data.frame) {
    el.frame.src = `data:${data.frame.mimeType};base64,${data.frame.base64}`;
    el.frameOverlay.classList.add('hidden');
    el.frameTimestamp.textContent = new Date(data.frame.capturedAt).toLocaleTimeString();
    el.frameAge.textContent = data.frame.ageMs != null ? `${data.frame.ageMs}ms old when last used` : '-';
  }

  renderRtspStatus(data.stats && data.stats.rtsp);

  if (data.lastError) {
    el.errorBanner.textContent = `Capture error: ${data.lastError}`;
    el.errorBanner.classList.remove('hidden');
  } else {
    el.errorBanner.classList.add('hidden');
  }

  el.statusPill.textContent = data.busy ? 'Evaluating...' : data.running ? 'Running' : 'Paused';
  el.statusPill.className = 'pill ' + (data.busy ? 'pill-busy' : data.running ? 'pill-ok' : 'pill-paused');
  el.toggleBtn.textContent = data.running ? 'Pause' : 'Resume';

  lastChecklistItems = data.checklist || [];
  if (editingId === null) {
    renderChecklist(lastChecklistItems);
  }

  renderStats(data.stats);
  renderGpuStats(data.stats && data.stats.gpu);
  renderCurrentActivity(data.currentActivity);
}

function renderChecklist(items) {
  el.checklist.innerHTML = '';

  if (!items || !items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No conditions yet. Add one above.';
    el.checklist.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = `checklist-item status-${item.status}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.disabled = true;
    checkbox.checked = item.status === 'true';
    checkbox.title = 'Set automatically by the AI - cannot be edited manually';

    const body = document.createElement('div');
    body.className = 'checklist-item-body';

    if (editingId === item.id) {
      body.appendChild(buildEditForm(item));
    } else {
      const promptEl = document.createElement('div');
      promptEl.className = 'checklist-item-prompt';
      promptEl.textContent = item.prompt;

      const meta = document.createElement('div');
      meta.className = 'checklist-item-meta';
      meta.textContent = describeStatus(item);

      body.appendChild(promptEl);
      body.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'checklist-item-actions';

    if (editingId !== item.id) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-btn';
      editBtn.textContent = 'Edit';
      editBtn.title = 'Edit this condition\'s wording';
      editBtn.addEventListener('click', () => {
        editingId = item.id;
        renderChecklist(lastChecklistItems);
      });
      actions.appendChild(editBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'x';
      removeBtn.title = 'Remove condition';
      removeBtn.addEventListener('click', () => removeItem(item.id));
      actions.appendChild(removeBtn);
    }

    li.appendChild(checkbox);
    li.appendChild(body);
    li.appendChild(actions);
    el.checklist.appendChild(li);
  }
}

function buildEditForm(item) {
  const form = document.createElement('form');
  form.className = 'checklist-edit-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = item.prompt;
  input.required = true;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    editingId = null;
    renderChecklist(lastChecklistItems);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = input.value.trim();
    if (!prompt) return;
    await saveEdit(item.id, prompt);
  });

  form.appendChild(input);
  form.appendChild(saveBtn);
  form.appendChild(cancelBtn);

  setTimeout(() => input.focus(), 0);

  return form;
}

async function saveEdit(id, prompt) {
  await fetch(`/api/checklist/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  editingId = null;
  fetchState();
}

function describeStatus(item) {
  const parts = [];
  if (item.status === 'pending') {
    parts.push('Waiting for first evaluation...');
  } else if (item.status === 'error') {
    parts.push(`Error: ${item.reason || 'unknown'}`);
  } else {
    parts.push(item.status === 'true' ? 'TRUE' : 'FALSE');
    if (item.reason) parts.push(item.reason);
  }

  if (item.lastCheckedAt) parts.push(`checked ${new Date(item.lastCheckedAt).toLocaleTimeString()}`);
  if (item.lastLatencyMs != null) parts.push(`${item.lastLatencyMs}ms`);
  return parts.join(' - ');
}

function renderStats(stats) {
  if (!stats) return;
  const { system, process: proc, pipeline } = stats;

  const rows = [
    ['CPU', `${system.cpuCores} cores, load ${system.loadAvg1m.toFixed(2)}`],
    ['Memory', `${system.usedMemGB}GB / ${system.totalMemGB}GB (${system.memUsagePct}%)`],
    ['Node process', `${proc.rssMB}MB RSS`],
    ['Model', pipeline.model],
    ['Checklist items', String(pipeline.checklistCount)],
    ['Eval interval', `${pipeline.evalIntervalMs}ms`],
    ['Avg frame freshness', fmtMs(pipeline.avgFrameAgeMs)],
    ['Last frame freshness', fmtMs(pipeline.lastFrameAgeMs)],
    ['Avg AI evaluation', fmtMs(pipeline.avgEvaluationMs)],
    ['Last cycle time', fmtMs(pipeline.lastCycleMs)],
    ['Estimated cycle time', fmtMs(pipeline.estimatedCycleMs)],
    ['Frames used', String(pipeline.framesUsed)],
    ['Frame errors', String(pipeline.frameErrors)],
    ['Failed evaluations', String(pipeline.evaluationsFailed)],
  ];

  fillStatsGrid(el.stats, rows);
  el.overloadWarning.classList.toggle('hidden', !pipeline.isOverloaded);
}

function renderGpuStats(gpu) {
  if (!gpu) return;

  if (!gpu.available) {
    fillStatsGrid(el.gpuStats, [['Status', gpu.lastError || 'unavailable']]);
    return;
  }

  if (gpu.source === 'tegrastats') {
    renderTegrastats(gpu);
    return;
  }

  if (!gpu.gpus.length) {
    fillStatsGrid(el.gpuStats, [['Status', 'No GPU devices reported']]);
    return;
  }

  const rows = [];
  gpu.gpus.forEach((g) => {
    const label = gpu.gpus.length > 1 ? `GPU ${g.index}` : 'GPU';
    rows.push([label, g.name || 'unknown']);
    rows.push(['Utilization', `${fmtPct(g.utilizationGpuPct)} core, ${fmtPct(g.utilizationMemPct)} mem controller`]);
    rows.push(['VRAM', `${fmtMB(g.memoryUsedMB)} / ${fmtMB(g.memoryTotalMB)}`]);
    rows.push(['Temp / Power', `${fmtC(g.temperatureC)}, ${fmtW(g.powerDrawW)}`]);
  });

  fillStatsGrid(el.gpuStats, rows);
}

function renderTegrastats(gpu) {
  const rows = [];

  // Engine
  const enginesOn = Object.entries(gpu.engines || {})
    .filter(([, v]) => v !== false)
    .map(([k]) => k)
    .join(', ') || 'none';
  rows.push(['GR3D_FREQ', `${gpu.gr3dFreq.pct != null ? fmtPct(gpu.gr3dFreq.pct) : '-'} (${gpu.gr3dFreq.freqMHz != null ? gpu.gr3dFreq.freqMHz + 'MHz' : '-'})`]);
  rows.push(['EMC_FREQ', `${gpu.emcFreq.pct != null ? fmtPct(gpu.emcFreq.pct) : '-'} (${gpu.emcFreq.freqMHz != null ? gpu.emcFreq.freqMHz + 'MHz' : '-'})`]);
  rows.push(['Active engines', enginesOn]);

  // VRAM (RAM on Jetson is shared)
  rows.push(['VRAM (RAM)', `${fmtMB(gpu.ram.usedMB)} / ${fmtMB(gpu.ram.totalMB)}`]);

  // CPU cores
  if (gpu.cpus && gpu.cpus.length) {
    const coreSummary = gpu.cpus.map((c, i) => `C${i}:${c.pct != null ? c.pct + '%' : '-'}`).join(', ');
    rows.push(['CPU cores', coreSummary]);
    const avgFreq = gpu.cpus.reduce((s, c) => s + (c.freqMHz || 0), 0) / gpu.cpus.length;
    rows.push(['CPU avg freq', `${Math.round(avgFreq)}MHz`]);
  }

  // Temperatures
  if (gpu.temperatures) {
    const tempParts = Object.entries(gpu.temperatures).map(([k, v]) => `${k}:${v.toFixed(1)}C`);
    rows.push(['Temperatures', tempParts.join(', ')]);
  }

  // Power
  if (gpu.power) {
    for (const [key, val] of Object.entries(gpu.power)) {
      const label = key.replace(/_/g, ' ');
      const avgW = (val.averageMW / 1000).toFixed(2);
      rows.push([label, `${fmtMW(val.currentMW)} / avg ${avgW}W`]);
    }
  }

  fillStatsGrid(el.gpuStats, rows);
}

function fillStatsGrid(container, rows) {
  container.innerHTML = '';
  for (const [label, value] of rows) {
    const dt = document.createElement('div');
    dt.className = 'stat-label';
    dt.textContent = label;
    const dd = document.createElement('div');
    dd.className = 'stat-value';
    dd.textContent = value;
    container.appendChild(dt);
    container.appendChild(dd);
  }
}

function renderRtspStatus(rtsp) {
  if (!rtsp || !el.rtspStatus) return;
  if (rtsp.sourceUrl && el.sourceUrlDisplay) {
    el.sourceUrlDisplay.textContent = rtsp.sourceUrl;
  }
  if (!rtsp.connected) {
    el.rtspStatus.textContent = `disconnected${rtsp.lastError ? ' - ' + rtsp.lastError : ''} (restarts: ${rtsp.restartCount})`;
    return;
  }
  if (!rtsp.hasFrame) {
    el.rtspStatus.textContent = 'connected, waiting for first frame...';
    return;
  }
  el.rtspStatus.textContent = `connected - decoder frame age ${rtsp.frameAgeMs}ms (restarts: ${rtsp.restartCount})`;
}

function renderCurrentActivity(activity) {
  if (!activity) {
    el.currentActivity.classList.add('hidden');
    return;
  }
  el.currentActivity.classList.remove('hidden');
  el.currentActivityCondition.textContent = `"${activity.condition}"`;
  el.currentActivityPrompt.textContent = activity.prompt;
}

// Rebuilding the log list on every poll would reset any <details> the user
// had expanded to inspect a prompt/response. To avoid that:
//   1. Skip the rebuild entirely if the set of log entries hasn't changed.
//   2. When it does rebuild (a new entry arrived), restore each entry's
//      previous open/closed state from `expandedLogIds`.
//   3. Preserve the scroll position of the log list across rebuilds.
function renderActivityLog(logs) {
  const signature = (logs || []).map((entry) => entry.id).join(',');
  if (signature === lastLogsSignature) {
    return;
  }
  lastLogsSignature = signature;

  const scrollTop = el.activityLog.scrollTop;
  el.activityLog.innerHTML = '';

  if (!logs || !logs.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No inference calls yet.';
    el.activityLog.appendChild(li);
    return;
  }

  for (const entry of logs) {
    const li = document.createElement('li');

    const details = document.createElement('details');
    details.className = 'activity-log-item';
    details.open = expandedLogIds.has(entry.id);
    details.addEventListener('toggle', () => {
      if (details.open) {
        expandedLogIds.add(entry.id);
      } else {
        expandedLogIds.delete(entry.id);
      }
    });

    const summary = document.createElement('summary');

    const badge = document.createElement('span');
    badge.className = `status-badge status-${entry.status}`;
    badge.textContent = entry.status;
    summary.appendChild(badge);

    if (entry.status === 'ok' && entry.parsed) {
      const resultBadge = document.createElement('span');
      resultBadge.className = `status-badge status-${entry.parsed.result ? 'true' : 'false'}`;
      resultBadge.textContent = entry.parsed.result ? 'TRUE' : 'FALSE';
      summary.appendChild(resultBadge);
    }

    const conditionEl = document.createElement('span');
    conditionEl.className = 'activity-summary-condition';
    conditionEl.textContent = entry.condition;

    const metaEl = document.createElement('span');
    metaEl.className = 'activity-summary-meta';
    metaEl.textContent = `${entry.latencyMs != null ? entry.latencyMs + 'ms' : ''} - ${new Date(entry.timestamp).toLocaleTimeString()}`;

    summary.appendChild(conditionEl);
    summary.appendChild(metaEl);

    const bodyEl = document.createElement('div');
    bodyEl.className = 'activity-body';

    bodyEl.appendChild(labeledBlock('Prompt sent to model', entry.prompt || '(unavailable)'));

    if (entry.status === 'ok') {
      bodyEl.appendChild(labeledBlock('Raw model response', entry.rawResponse || '(empty)'));
      if (entry.parsed) {
        bodyEl.appendChild(labeledBlock('Parsed result', JSON.stringify(entry.parsed, null, 2)));
      }
    } else {
      bodyEl.appendChild(labeledBlock('Error', entry.error || 'unknown error'));
    }

    details.appendChild(summary);
    details.appendChild(bodyEl);
    li.appendChild(details);
    el.activityLog.appendChild(li);
  }

  el.activityLog.scrollTop = scrollTop;
}

function labeledBlock(label, text) {
  const wrap = document.createElement('div');
  const strong = document.createElement('div');
  strong.className = 'stat-label';
  strong.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = text;
  wrap.appendChild(strong);
  wrap.appendChild(pre);
  return wrap;
}

function fmtMs(v) {
  return v == null ? '-' : `${v}ms`;
}

function fmtPct(v) {
  return v == null ? '-' : `${v}%`;
}

function fmtMB(v) {
  return v == null ? '-' : `${v}MB`;
}

function fmtC(v) {
  return v == null ? '-' : `${v}C`;
}

function fmtW(v) {
  return v == null ? '-' : `${v}W`;
}

function fmtMW(v) {
  return v == null ? '-' : `${v}mW`;
}

async function removeItem(id) {
  await fetch(`/api/checklist/${id}`, { method: 'DELETE' });
  fetchState();
}

el.addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = el.promptInput.value.trim();
  if (!prompt) return;
  await fetch('/api/checklist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  el.promptInput.value = '';
  fetchState();
});

el.toggleBtn.addEventListener('click', async () => {
  const endpoint = state.running ? '/api/control/stop' : '/api/control/start';
  await fetch(endpoint, { method: 'POST' });
  fetchState();
});

el.evalNowBtn.addEventListener('click', async () => {
  await fetch('/api/control/evaluate-now', { method: 'POST' });
  fetchState();
});

// --- Settings: model + interval, editable from the UI without a restart ---

async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    el.modelSelect.innerHTML = '';
    for (const m of data.models || []) {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.vision ? `${m.name} (vision)` : m.name;
      el.modelSelect.appendChild(opt);
    }
    if (!data.models || !data.models.length) {
      const opt = document.createElement('option');
      opt.textContent = 'No models found on Groq';
      el.modelSelect.appendChild(opt);
    }
  } catch (err) {
    el.modelSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.textContent = 'Could not load models from Groq';
    el.modelSelect.appendChild(opt);
  }
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    if (data.model) {
      const hasOption = Array.from(el.modelSelect.options).some((o) => o.value === data.model);
      if (!hasOption) {
        const opt = document.createElement('option');
        opt.value = data.model;
        opt.textContent = data.model;
        el.modelSelect.prepend(opt);
      }
      el.modelSelect.value = data.model;
    }
    if (data.evalIntervalMs) {
      el.intervalInput.value = Math.round(data.evalIntervalMs / 1000);
    }
    if (data.gpuStatsSource) {
      el.gpuSourceSelect.value = data.gpuStatsSource;
    }
    if (data.rtspUrl) {
      el.rtspUrlInput.value = data.rtspUrl;
      if (el.sourceUrlDisplay) el.sourceUrlDisplay.textContent = data.rtspUrl;
    }
  } catch (err) {
    // ignore - fields just stay at their defaults
  }
}

el.saveSettingsBtn.addEventListener('click', async () => {
  const model = el.modelSelect.value;
  const seconds = parseFloat(el.intervalInput.value);
  const gpuStatsSource = el.gpuSourceSelect.value;
  const rtspUrl = el.rtspUrlInput.value.trim() || undefined;

  if (!model || !seconds || seconds < 1) {
    el.settingsStatus.textContent = 'Pick a model and an interval of at least 1 second.';
    return;
  }

  el.settingsStatus.textContent = 'Saving...';
  try {
    const body = { model, evalIntervalMs: Math.round(seconds * 1000), gpuStatsSource };
    if (rtspUrl) body.rtspUrl = rtspUrl;
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    const saved = await res.json();
    if (saved.rtspUrl && el.sourceUrlDisplay) {
      el.sourceUrlDisplay.textContent = saved.rtspUrl;
    }
    el.settingsStatus.textContent = 'Saved - camera source will restart with new URL.';
  } catch (err) {
    el.settingsStatus.textContent = `Error: ${err.message}`;
  }
});

// --- Trend charts (RAM / GPU / cycle time / avg AI evaluation) ---

function initCharts() {
  if (typeof Chart === 'undefined') return;

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { display: false },
      y: {
        beginAtZero: true,
        ticks: { color: '#9aa1ac', font: { size: 10 } },
        grid: { color: '#2a2e38' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { enabled: true },
    },
    elements: {
      point: { radius: 0, hoverRadius: 4 },
      line: { tension: 0.25, borderWidth: 2 },
    },
  };

  const makeChart = (canvasId, label, color, bgColor) => new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: { labels: [], datasets: [{ label, data: [], borderColor: color, backgroundColor: bgColor, fill: true }] },
    options: commonOptions,
  });

  charts = {
    ram: makeChart('ramChart', 'RAM %', '#5b9dff', 'rgba(91, 157, 255, 0.15)'),
    gpu: makeChart('gpuChart', 'GPU %', '#3ecf8e', 'rgba(62, 207, 142, 0.15)'),
    cycle: makeChart('cycleChart', 'Cycle ms', '#f0a93e', 'rgba(240, 169, 62, 0.15)'),
    evalTime: makeChart('evalChart', 'Avg eval ms', '#ef5a5a', 'rgba(239, 90, 90, 0.15)'),
  };
}

function updateCharts(points) {
  if (!charts) return;
  const labels = points.map((p) => new Date(p.t).toLocaleTimeString());

  setChartData(charts.ram, labels, points.map((p) => p.ramPct));
  setChartData(charts.gpu, labels, points.map((p) => p.gpuMemPct));
  setChartData(charts.cycle, labels, points.map((p) => p.cycleMs));
  setChartData(charts.evalTime, labels, points.map((p) => p.avgEvalMs));
}

function setChartData(chart, labels, data) {
  chart.data.labels = labels;
  chart.data.datasets[0].data = data;
  chart.update('none');
}

initCharts();
loadModels().then(loadSettings);

fetchState();
fetchLogs();
fetchHistory();
setInterval(fetchState, POLL_MS);
setInterval(fetchLogs, POLL_MS);
setInterval(fetchHistory, POLL_MS);
