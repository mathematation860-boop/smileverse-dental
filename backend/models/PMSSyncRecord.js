const mongoose = require('mongoose');

/**
 * Local <-> PMS synchronization mapping (Phase 6 spec §19). This is
 * metadata ABOUT the relationship between one local Appointment document
 * and its real (or mock) PMS-side counterpart — never a second copy of
 * appointment data (spec §18: "do not create a second competing
 * appointment database"). The PMS remains the source of truth for PMS
 * appointment state once a practice is live; this collection is just the
 * map between the two IDs plus enough status to know whether that map is
 * trustworthy.
 *
 * `externalAppointmentId` is unique WITHIN practice scope (spec §19) —
 * the compound unique index below also doubles as the idempotency
 * guarantee against duplicate records on a retried booking attempt,
 * exactly like NotificationLog's unique idempotencyKey index in Phase 5.
 */
const pmsSyncRecordSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  localAppointmentId: { type: String, required: true },
  externalAppointmentId: { type: String, required: true },
  externalPatientId: { type: String, default: null },
  provider: { type: String, required: true }, // 'mock' | 'openDental'
  syncStatus: { type: String, enum: ['linked', 'pending', 'failed', 'cancelled', 'rescheduled'], default: 'linked' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastSyncedAt: { type: Date, default: Date.now },
});

pmsSyncRecordSchema.index({ practiceId: 1, localAppointmentId: 1 }, { unique: true });
pmsSyncRecordSchema.index({ practiceId: 1, externalAppointmentId: 1 }, { unique: true });

module.exports = mongoose.models.PMSSyncRecord || mongoose.model('PMSSyncRecord', pmsSyncRecordSchema);
