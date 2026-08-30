const express = require('express');
const { getAppointmentProvider } = require('../services/providers');

const router = express.Router();

// GET /api/availability/dates -> next N open dates (for the date picker)
router.get('/availability/dates', (req, res) => {
  const count = Math.min(Number(req.query.count) || 14, 60);
  const provider = getAppointmentProvider(req.practice);
  res.json({ dates: provider.getAvailableDates(req.practice, count) });
});

// GET /api/availability?date=YYYY-MM-DD -> open time slots for that date
router.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }
  const provider = getAppointmentProvider(req.practice);
  const result = await provider.getAvailability(req.practice, date);
  res.json(result);
});

module.exports = router;
