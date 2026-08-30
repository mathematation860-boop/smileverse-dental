const express = require('express');
const tools = require('../tools/receptionistTools');

const router = express.Router();

router.get('/insurance', (req, res) => {
  res.json(tools.get_insurance_information(req.practice));
});

router.post('/insurance/check', (req, res) => {
  const { provider } = req.body;
  if (!provider) {
    return res.status(400).json({ error: 'provider is required' });
  }
  res.json(tools.get_insurance_information(req.practice, provider));
});

module.exports = router;
