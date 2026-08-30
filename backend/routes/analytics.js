const express = require('express');
const analyticsRepository = require('../repositories/AnalyticsRepository');

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
  try {
    await analyticsRepository.logEvent(req.practiceId, name, conversationId, payload || {});
    res.json({ success: true });
  } catch (err) {
    console.error('Analytics log failed (non-fatal):', err.message);
    res.json({ success: false });
  }
});

// GET /api/analytics/summary -> counts per event name (stub for a future admin dashboard).
router.get('/analytics/summary', async (req, res) => {
  try {
    const summary = await analyticsRepository.getSummary(req.practiceId);
    res.json({ summary, demoMode: req.practice.demoMode });
  } catch (err) {
    res.json({ summary: [], demoMode: req.practice.demoMode });
  }
});

module.exports = router;
