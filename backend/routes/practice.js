const express = require('express');
const practiceConfig = require('../config/practiceConfig');

const router = express.Router();

// Full config the frontend needs to render services, hours, contact info,
// and policies without any of it being hard-coded in components.
router.get('/practice-config', (req, res) => {
  res.json(practiceConfig);
});

// Backward-compatible shorter endpoint the original frontend used.
router.get('/clinic-info', (req, res) => {
  res.json({
    name: practiceConfig.name,
    hours: practiceConfig.hours.display,
    phone: practiceConfig.phone,
    email: practiceConfig.email,
    location: practiceConfig.address,
    services: practiceConfig.services
      .filter((s) => s.price !== null)
      .map((s) => ({ name: s.name, price: s.price, duration: s.duration })),
  });
});

module.exports = router;
