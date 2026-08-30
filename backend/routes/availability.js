const express = require('express');
const { getAppointmentProvider } = require('../services/providers');
const tools = require('../tools/receptionistTools');
const { CalendarUnavailableError, SlotUnavailableError } = require('../services/providers/CalendarProviderErrors');

const router = express.Router();

// GET /api/availability/dates -> next N open dates (for the date picker)
router.get('/availability/dates', (req, res) => {
  const count = Math.min(Number(req.query.count) || 14, 60);
  const provider = getAppointmentProvider(req.practice);
  res.json({ dates: provider.getAvailableDates(req.practice, count) });
});

// GET /api/availability?date=YYYY-MM-DD[&durationMinutes=45] -> open time slots for that date.
// durationMinutes is optional (defaults to the practice's default slot length) — pass it once a
// service is known so a real calendar correctly excludes slots too short to fit that service.
router.get('/availability', async (req, res) => {
  const { date } = req.query;
  if (!date) {
    return res.status(400).json({ error: 'date is required (YYYY-MM-DD)' });
  }
  const durationMinutes = req.query.durationMinutes ? Number(req.query.durationMinutes) : undefined;

  try {
    const result = await tools.check_availability(req.practice, date, { durationMinutes });
    res.json(result);
  } catch (error) {
    if (error instanceof CalendarUnavailableError) {
      console.error('Availability check failed (calendar unavailable):', error.reason, error.cause?.message || '');
      return res.status(503).json({ error: error.message, reason: error.reason });
    }
    if (error instanceof SlotUnavailableError) {
      return res.status(409).json({ error: error.message, reason: error.reason });
    }
    console.error('Availability Error:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

module.exports = router;
