const mongoose = require('mongoose');

/**
 * One document per phone call (Phase 4 spec §19/§20 — the admin Voice
 * dashboard's "total/answered/transferred/missed calls" tiles and the
 * Call History list are both read straight off this collection, never
 * estimated or hard-coded). `callSid` is Twilio's own call identifier in
 * production (or a generated id in mock mode — see MockTelephonyProvider),
 * and doubles as the conversationId services/conversationStore.js uses to
 * key that call's slot memory/history, so the two can always be
 * cross-referenced.
 */
const callLogSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  callSid: { type: String, required: true, unique: true, index: true },
  fromNumber: String,
  toNumber: String,
  // 'in_progress' until the telephony provider's status callback (or an
  // unrecoverable error) reports how the call actually ended — never
  // guessed or defaulted to "completed" just because our webhook handler
  // returned normally.
  status: { type: String, enum: ['in_progress', 'completed', 'failed', 'no_answer', 'busy'], default: 'in_progress' },
  // What actually happened on the call, updated as real events occur
  // (never inferred after the fact). 'unknown' until something definite
  // happens; multiple flags below can all be true on one call (e.g. an
  // emergency that also triggered a handoff).
  outcome: {
    type: String,
    enum: ['unknown', 'appointment_booked', 'appointment_cancelled', 'appointment_rescheduled', 'human_handoff', 'emergency', 'faq_only', 'abandoned'],
    default: 'unknown',
  },
  appointmentCreated: { type: Boolean, default: false },
  handoffRequested: { type: Boolean, default: false },
  emergencyDetected: { type: Boolean, default: false },
  turnCount: { type: Number, default: 0 },
  // Whether this call ran through the real Twilio provider or the mock
  // provider — recorded per-call (not just read off current practice
  // config) so a practice's history stays accurate even if its
  // demoMode/provider setting changes later. Never used to claim a call
  // was "real" unless this is genuinely true.
  demoMode: { type: Boolean, default: true },
  startedAt: { type: Date, default: Date.now },
  endedAt: Date,
  durationSeconds: Number,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.CallLog || mongoose.model('CallLog', callLogSchema);
