const app = require('./src/app');
const config = require('./src/config');
const evaluator = require('./src/services/evaluator');
const gpuStats = require('./src/services/gpuStats');
const rtspCapture = require('./src/services/rtspCapture');
const metricsHistory = require('./src/services/metricsHistory');

app.listen(config.port, async () => {
  console.log(`Process Checklist running at http://localhost:${config.port}`);
  console.log(`RTSP source: ${config.rtspUrl || '(not configured)'}`);
  console.log(`Ollama model: ${config.ollamaModel} @ ${config.ollamaHost}`);
  console.log(`GPU stats source: ${config.gpuStatsSource}`);

  rtspCapture.start();
  gpuStats.setSource(config.gpuStatsSource);
  gpuStats.start();
  metricsHistory.start();

  try {
    await rtspCapture.waitForFirstFrame(config.firstFrameTimeoutMs);
    console.log('RTSP: first frame received, camera feed is live.');
  } catch (err) {
    console.warn(`RTSP: no frame yet (${err.message}). Will keep retrying in the background.`);
  }

  evaluator.start();
});

process.on('SIGINT', () => {
  evaluator.stop();
  gpuStats.stop();
  rtspCapture.stop();
  metricsHistory.stop();
  process.exit(0);
});
