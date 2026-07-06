const express = require('express');
const config = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    rtspUrl: config.rtspUrl,
    model: config.groqModel,
    evalIntervalMs: config.evalIntervalMs,
  });
});

module.exports = router;
