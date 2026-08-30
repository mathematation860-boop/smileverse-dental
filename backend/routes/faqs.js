const express = require('express');

const router = express.Router();

router.get('/faqs', (req, res) => {
  res.json(req.practice.faqs);
});

module.exports = router;
