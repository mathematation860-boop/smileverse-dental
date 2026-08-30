const express = require('express');
const tools = require('../tools/receptionistTools');

const router = express.Router();

// Full config the frontend needs to render services, hours, contact info,
// and policies without any of it being hard-coded in components. Scoped
// to whichever practice the request resolved to (see middleware/practiceContext.js).
router.get('/practice-config', (req, res) => {
  const info = tools.get_practice_info(req.practice);
  res.json({ ...info, services: tools.get_services(req.practice) });
});

// Backward-compatible shorter endpoint the original frontend used.
router.get('/clinic-info', (req, res) => {
  const practice = req.practice;
  res.json({
    name: practice.name,
    hours: practice.hours.display,
    phone: practice.phone,
    email: practice.email,
    location: practice.address,
    services: practice.services
      .filter((s) => s.price !== null)
      .map((s) => ({ name: s.name, price: s.price, duration: s.duration })),
  });
});

module.exports = router;
