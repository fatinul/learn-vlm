const express = require('express');
const config = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    rtspUrl: config.rtspUrl,
    provider: config.inferenceProvider,
    model: config.inferenceProvider === 'groq' ? config.groqModel : config.ollamaModel,
    evalIntervalMs: config.evalIntervalMs,
  });
});

module.exports = router;
