const express = require('express');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

const VALID_EVENT_NAMES = new Set([
  'conversation_started',
  'appointment_requested',
  'appointment_booked',
  'appointment_cancelled',
  'appointment_rescheduled',
  'emergency_request',
  'human_handoff_requested',
  'unanswered_question',
]);

// POST /api/analytics/event -> fire-and-forget event logging from the frontend.
router.post('/analytics/event', async (req, res) => {
  const { name, conversationId, payload } = req.body || {};
  if (!VALID_EVENT_NAMES.has(name)) {
    // Don't fail the frontend over an unknown event name — just ignore it.
    return res.json({ success: false, ignored: true });
  }
  await analyticsService.logEvent(name, conversationId, payload || {});
  res.json({ success: true });
});

// GET /api/analytics/summary -> counts per event name (stub for a future admin dashboard).
router.get('/analytics/summary', async (req, res) => {
  const summary = await analyticsService.getSummary();
  res.json({ summary });
});

module.exports = router;
