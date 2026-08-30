const express = require('express');
const insuranceService = require('../services/insuranceService');

const router = express.Router();

router.get('/insurance', (req, res) => {
  res.json(insuranceService.listAccepted());
});

router.post('/insurance/check', (req, res) => {
  const { provider } = req.body;
  if (!provider) {
    return res.status(400).json({ error: 'provider is required' });
  }
  res.json(insuranceService.checkProvider(provider));
});

module.exports = router;
