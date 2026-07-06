const { spawn } = require('child_process');
const config = require('../config');

/**
 * Keeps a single persistent ffmpeg process connected to the RTSP stream,
 * continuously decoding frames and always holding on to the most recently
 * decoded one in memory.
 *
 * This matters for latency: spawning a fresh ffmpeg process per capture (the
 * previous approach) has to reconnect and then wait for the stream's next
 * keyframe before it can produce anything, which can lag several seconds
 * behind real time depending on the camera's GOP size. With a persistent
 * connection, `getLatestFrame()` just returns whatever is already sitting in
 * memory - effectively the newest frame the camera has produced, with only
 * milliseconds of latency.
 */
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;

let sourceUrl = config.rtspUrl;

const state = {
  process: null,
  stopped: true,
  incoming: Buffer.alloc(0),
  latestFrame: null, // { buffer, capturedAt: Date }
  restartCount: 0,
  restartTimer: null,
  lastError: null,
};

function start() {
  if (state.process) return;
  state.stopped = false;

  if (!sourceUrl) {
    state.lastError = 'RTSP_URL is not configured';
    return;
  }

  const args = [
    '-rtsp_transport', config.rtspTransport,
    '-fflags', 'nobuffer',
    '-flags', 'low_delay',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-i', sourceUrl,
    '-an',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '4',
    '-r', String(config.captureFps),
    'pipe:1',
  ];

  const ffmpeg = spawn(config.ffmpegPath, args);
  state.process = ffmpeg;
  state.incoming = Buffer.alloc(0);

  ffmpeg.stdout.on('data', onData);
  ffmpeg.stderr.on('data', () => {
    // ffmpeg logs verbosely to stderr; intentionally not surfaced here to
    // keep logs quiet. Re-enable for debugging RTSP connection issues.
  });

  ffmpeg.on('error', (err) => {
    state.lastError = `Failed to start ffmpeg: ${err.message}`;
    handleExit();
  });

  ffmpeg.on('close', (code) => {
    if (!state.stopped) {
      state.lastError = code ? `ffmpeg exited with code ${code}` : state.lastError;
    }
    handleExit();
  });
}

function onData(chunk) {
  state.incoming = state.incoming.length
    ? Buffer.concat([state.incoming, chunk])
    : chunk;

  // A continuous MJPEG stream is just JPEG images back to back. Pull out
  // every complete frame present so far and keep only the last one - older
  // ones in the same batch are already stale by definition.
  let searchFrom = 0;
  while (true) {
    const soi = state.incoming.indexOf(JPEG_SOI, searchFrom);
    if (soi === -1) break;
    const eoi = state.incoming.indexOf(JPEG_EOI, soi + JPEG_SOI.length);
    if (eoi === -1) break;

    const frameEnd = eoi + JPEG_EOI.length;
    state.latestFrame = {
      buffer: Buffer.from(state.incoming.subarray(soi, frameEnd)),
      capturedAt: new Date(),
    };
    searchFrom = frameEnd;
  }

  state.incoming = searchFrom > 0 ? state.incoming.subarray(searchFrom) : state.incoming;
  if (state.incoming.length > MAX_BUFFER_BYTES) {
    state.incoming = Buffer.alloc(0);
  }
}

function handleExit() {
  state.process = null;
  if (state.stopped) return;

  state.restartCount += 1;
  const delay = Math.min(1000 * state.restartCount, 10000);
  if (state.restartTimer) clearTimeout(state.restartTimer);
  state.restartTimer = setTimeout(() => {
    state.restartTimer = null;
    start();
  }, delay);
}

function stop() {
  state.stopped = true;
  if (state.restartTimer) {
    clearTimeout(state.restartTimer);
    state.restartTimer = null;
  }
  if (state.process) {
    state.process.kill('SIGKILL');
    state.process = null;
  }
}

/**
 * Returns the freshest decoded frame currently in memory. Throws if no
 * frame has ever been received (e.g. camera unreachable, still connecting).
 */
function getLatestFrame() {
  if (!state.latestFrame) {
    throw new Error(state.lastError || 'No frame received yet from RTSP stream');
  }
  return state.latestFrame;
}

/** Polls until the first frame arrives, or rejects after `timeoutMs`. */
function waitForFirstFrame(timeoutMs) {
  if (state.latestFrame) return Promise.resolve(state.latestFrame);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (state.latestFrame) {
        resolve(state.latestFrame);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(state.lastError || 'Timed out waiting for the first frame'));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

function changeSource(newUrl) {
  const oldStopped = state.stopped;
  stop();
  sourceUrl = newUrl || config.rtspUrl;
  state.restartCount = 0;
  state.latestFrame = null;
  state.lastError = null;
  state.stopped = oldStopped;
  start();
}

function getStatus() {
  return {
    connected: !!state.process,
    hasFrame: !!state.latestFrame,
    lastFrameAt: state.latestFrame ? state.latestFrame.capturedAt.toISOString() : null,
    frameAgeMs: state.latestFrame ? Date.now() - state.latestFrame.capturedAt.getTime() : null,
    restartCount: state.restartCount,
    lastError: state.lastError,
    sourceUrl,
  };
}

module.exports = { start, stop, changeSource, getLatestFrame, waitForFirstFrame, getStatus };
