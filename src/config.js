require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),

  rtspUrl: process.env.RTSP_URL || '',
  rtspTransport: process.env.RTSP_TRANSPORT || 'tcp',
  // ffmpeg keeps a persistent connection open and continuously decodes at
  // this rate, always keeping the single most recent frame in memory. This
  // is what lets an evaluation cycle grab the freshest possible frame
  // instantly instead of reconnecting (and waiting for the next keyframe)
  // every time.
  captureFps: parseInt(process.env.CAPTURE_FPS || '5', 10),
  // How long to wait at startup for the very first frame to arrive.
  firstFrameTimeoutMs: parseInt(process.env.FRAME_CAPTURE_TIMEOUT_MS || '10000', 10),

  inferenceProvider: process.env.INFERENCE_PROVIDER === 'ollama' ? 'ollama' : 'groq',

  groqApiKey: process.env.GROQ_API_KEY || '',
  groqBaseUrl: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  groqModel: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
  groqTimeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS || '60000', 10),

  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3.5:2b',
  ollamaTimeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS || '60000', 10),

  evalIntervalMs: parseInt(process.env.EVAL_INTERVAL_MS || '8000', 10),

  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',

  gpuStatsSource: process.env.GPU_STATS_SOURCE || 'nvidia-smi',
};
