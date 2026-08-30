const express = require('express');
const availabilityService = require('../services/availabilityService');
const Appointment = require('../models/Appointment');

const router = express.Router();

// GET /api/availability/dates -> next 14 open dates (for the date picker)
router.get('/availability/dates', (req, res) => {
  const count = Math.min(Number(req.query.count) || 14, 30);
  res.json({ dates: availabilityService.nextOpenDates(count) });
});

// GET /api/availability?date=YYYY-MM-DD -> open time slots for that date
router.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }

  let bookedTimes = [];
  try {
    const existing = await Appointment.find({ date, status: { $ne: 'Cancelled' } }).select('time');
    bookedTimes = existing.map((a) => a.time).filter(Boolean);
  } catch (err) {
    // If the DB is unreachable, fall back to mock-only availability rather than failing the request.
    console.error('Availability DB lookup failed (falling back to mock-only):', err.message);
  }

  const slots = availabilityService.getAvailableSlots(date, { bookedTimes });
  res.json({ date, slots, isOpen: availabilityService.isOpenDay(date) });
});

module.exports = router;
