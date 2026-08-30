const mongoose = require('mongoose');

/**
 * Safe audit trail for PMS operations (Phase 6 spec §27). Deliberately
 * mirrors NotificationLog's philosophy from Phase 5: store IDENTIFIERS
 * and OUTCOMES, never request/response bodies, never patient clinical
 * detail, never credentials. `event` is one of a small closed set so
 * this can never accidentally become a dumping ground for arbitrary
 * payloads.
 */
const pmsAuditLogSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  event: {
    type: String,
    required: true,
    enum: [
      'patient_lookup',
      'patient_created',
      'appointment_lookup',
      'availability_lookup',
      'booking_attempted',
      'booking_succeeded',
      'booking_failed',
      'cancellation_succeeded',
      'cancellation_failed',
      'reschedule_succeeded',
      'reschedule_failed',
      'connection_test',
    ],
  },
  provider: { type: String, default: null }, // 'mock' | 'openDental'
  conversationId: { type: String, default: null },
  localAppointmentId: { type: String, default: null },
  externalAppointmentId: { type: String, default: null },
  outcome: { type: String, enum: ['success', 'failure'], required: true },
  failureReason: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

pmsAuditLogSchema.index({ practiceId: 1, createdAt: -1 });

module.exports = mongoose.models.PMSAuditLog || mongoose.model('PMSAuditLog', pmsAuditLogSchema);
