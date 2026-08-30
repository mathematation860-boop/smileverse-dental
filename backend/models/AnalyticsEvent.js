const mongoose = require('mongoose');

/**
 * Generic event log. Kept intentionally schema-loose (a `name` + a JSON
 * `payload`) so new event types don't require migrations — this is the
 * "clean frontend/backend event abstraction" the product spec asks for,
 * ready to be pointed at a real analytics pipeline later without
 * changing how events are fired from the UI (see frontend analytics.js).
 */
const analyticsEventSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  name: {
    type: String,
    required: true,
    enum: [
      'conversation_started',
      'appointment_requested',
      'appointment_booked',
      'appointment_cancelled',
      'appointment_rescheduled',
      'emergency_request',
      'human_handoff_requested',
      'unanswered_question',
    ],
  },
  conversationId: String,
  payload: mongoose.Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.AnalyticsEvent || mongoose.model('AnalyticsEvent', analyticsEventSchema);
