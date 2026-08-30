const express = require('express');
const faqCategories = require('../config/faqs');

const router = express.Router();

router.get('/faqs', (req, res) => {
  res.json(faqCategories);
});

module.exports = router;
