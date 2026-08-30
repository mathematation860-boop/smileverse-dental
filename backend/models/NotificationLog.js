const mongoose = require('mongoose');

/**
 * One document per notification attempt (Phase 5 spec §17/§18/§23). The
 * admin Notifications dashboard's stat tiles and the Notification History
 * list are both read straight off this collection, never estimated or
 * hard-coded — an empty history reports 0s/an empty list, never sample
 * data (same convention as models/CallLog.js from Phase 4).
 *
 * `idempotencyKey` is unique and is what actually PREVENTS a duplicate
 * send (Phase 5 spec §9/§24): every call site computes it deterministically
 * from stable facts (practiceId + appointmentId/conversationId + type +
 * channel, plus a scheduled timestamp for reminders) BEFORE attempting a
 * send, and claims it with an atomic upsert — see
 * repositories/NotificationLogRepository.js#claimAndRecord. A retried
 * webhook, a re-run reminder poll, or a second server instance all resolve
 * to the exact same key, so Mongo's own unique-index constraint is the
 * thing that makes "never send this notification twice" true even across
 * process restarts or multiple running instances — not anything held only
 * in memory.
 *
 * Deliberately does NOT store the rendered message body/content (spec
 * §17/§18: "Do NOT store unnecessary sensitive content") — only enough
 * metadata to explain what happened and to whom (masked), never the
 * message text itself.
 */
const notificationLogSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  idempotencyKey: { type: String, required: true, unique: true },

  appointmentId: { type: String, default: null, index: true },
  conversationId: { type: String, default: null },
  callSid: { type: String, default: null },

  type: {
    type: String,
    enum: ['appointment_confirmation', 'appointment_rescheduled', 'appointment_cancelled', 'appointment_reminder', 'human_handoff', 'emergency_alert'],
    required: true,
  },
  channel: { type: String, enum: ['sms', 'email'], required: true },
  language: { type: String, enum: ['en', 'ur'], default: 'en' },

  // Never the real destination — see services/notifications/validation.js's mask* helpers.
  destinationMasked: { type: String, default: null },

  // 'simulated' = demo mode, never actually attempted delivery (spec §3).
  // 'sent' = a real provider confirmed acceptance (spec §4/§30 — never set
  // optimistically). 'failed' = a real attempt was made and did not succeed.
  status: { type: String, enum: ['simulated', 'sent', 'failed'], required: true },

  provider: { type: String, default: null }, // e.g. 'mock' | 'twilio' | 'sendgrid' — never a secret/credential
  providerMessageId: { type: String, default: null },
  providerStatus: { type: String, default: null },
  failureReason: { type: String, default: null },
  attempts: { type: Number, default: 1 },

  // Recorded per-attempt (not just read off current practice config) so
  // history stays accurate even if a practice's demoMode changes later —
  // same convention as models/CallLog.js's own `demoMode` field.
  demoMode: { type: Boolean, default: true },

  createdAt: { type: Date, default: Date.now },
});

notificationLogSchema.index({ practiceId: 1, createdAt: -1 });

module.exports = mongoose.models.NotificationLog || mongoose.model('NotificationLog', notificationLogSchema);
