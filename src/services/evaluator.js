const rtspCapture = require('./rtspCapture');
const inferenceClient = require('./inferenceClient');
const checklistStore = require('./checklistStore');
const systemStats = require('./systemStats');
const inferenceLog = require('./inferenceLog');
const runtimeConfig = require('./runtimeConfig');

/**
 * Orchestrates the agentic loop:
 *   1. grab the freshest frame ffmpeg currently has decoded from the RTSP
 *      stream (see rtspCapture.js - it's a persistent connection, so this
 *      is effectively instant and always up to date, not a stale snapshot)
 *   2. run every checklist condition against it through the active provider
 *   3. store the (read-only, AI-controlled) result on each checklist item
 * Runs on a timer and guards against overlapping cycles since a full pass
 * can take longer than the configured interval on slower hardware.
 *
 * While a condition is being evaluated, `state.currentActivity` exposes the
 * exact prompt in flight so the UI can show live progress; once it settles,
 * the full prompt + raw model response are recorded in `inferenceLog`.
 */
const state = {
  running: false,
  busy: false,
  latestFrame: null, // { base64, mimeType, capturedAt, ageMs }
  lastError: null,
  timer: null,
  currentActivity: null, // { conditionId, condition, prompt, model, startedAt }
};

async function runCycle() {
  if (state.busy) return;
  state.busy = true;
  const cycleStart = Date.now();

  try {
    const frame = rtspCapture.getLatestFrame();
    const ageMs = Date.now() - frame.capturedAt.getTime();
    state.latestFrame = {
      base64: frame.buffer.toString('base64'),
      mimeType: 'image/jpeg',
      capturedAt: frame.capturedAt.toISOString(),
      ageMs,
    };
    systemStats.recordFrameUse(ageMs);
    state.lastError = null;

    const items = checklistStore.list();
    for (const item of items) {
      const evalStart = Date.now();
      const settings = runtimeConfig.get();
      const prompt = inferenceClient.buildPrompt(item.prompt);

      state.currentActivity = {
        conditionId: item.id,
        condition: item.prompt,
        prompt,
        model: settings.model,
        provider: settings.provider,
        startedAt: new Date().toISOString(),
      };

      try {
        const outcome = await inferenceClient.askYesNo({
          imageBase64: state.latestFrame.base64,
          mimeType: state.latestFrame.mimeType,
          condition: item.prompt,
        });
        checklistStore.update(item.id, {
          status: outcome.result ? 'true' : 'false',
          confidence: outcome.confidence,
          reason: outcome.reason,
          lastCheckedAt: new Date().toISOString(),
          lastLatencyMs: outcome.latencyMs,
        });
        systemStats.recordEvaluation(outcome.latencyMs, true);
        inferenceLog.add({
          conditionId: item.id,
          condition: item.prompt,
          model: settings.model,
          provider: settings.provider,
          prompt: outcome.prompt,
          rawResponse: outcome.rawResponse,
          parsed: { result: outcome.result, confidence: outcome.confidence, reason: outcome.reason },
          status: 'ok',
          error: null,
          latencyMs: outcome.latencyMs,
        });
      } catch (err) {
        checklistStore.update(item.id, {
          status: 'error',
          reason: err.message,
          lastCheckedAt: new Date().toISOString(),
          lastLatencyMs: Date.now() - evalStart,
        });
        systemStats.recordEvaluation(Date.now() - evalStart, false);
        inferenceLog.add({
          conditionId: item.id,
          condition: item.prompt,
          model: settings.model,
          provider: settings.provider,
          prompt: err.prompt || prompt,
          rawResponse: null,
          parsed: null,
          status: 'error',
          error: err.message,
          latencyMs: Date.now() - evalStart,
        });
      } finally {
        state.currentActivity = null;
      }
    }
  } catch (err) {
    state.lastError = err.message;
    systemStats.recordFrameError();
  } finally {
    systemStats.recordCycle(Date.now() - cycleStart);
    state.busy = false;
  }
}

function start() {
  if (state.running) return;
  state.running = true;

  const loop = async () => {
    if (!state.running) return;
    await runCycle();
    if (state.running) {
      state.timer = setTimeout(loop, runtimeConfig.get().evalIntervalMs);
    }
  };

  loop();
}

function stop() {
  state.running = false;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

function getState() {
  return {
    running: state.running,
    busy: state.busy,
    lastError: state.lastError,
    latestFrame: state.latestFrame,
    currentActivity: state.currentActivity,
  };
}

async function evaluateNow() {
  await runCycle();
}

module.exports = { start, stop, getState, evaluateNow };
