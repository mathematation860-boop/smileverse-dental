/**
 * PMSSyncRecord data access, scoped by practiceId on every query — same
 * convention as every other repository in this codebase (see
 * repositories/NotificationLogRepository.js's header comment for why).
 */

const PMSSyncRecord = require('../models/PMSSyncRecord');

/** Creates the mapping the FIRST time a local appointment is linked to a PMS appointment. Idempotent against retries: if a record for this localAppointmentId already exists (e.g. a retried booking that already succeeded once), this returns the EXISTING record rather than throwing a duplicate-key error or creating a second one (spec §19: "do not duplicate records during retries"). */
async function linkAppointment(practiceId, { localAppointmentId, externalAppointmentId, externalPatientId, provider }) {
  const existing = await PMSSyncRecord.findOne({ practiceId, localAppointmentId: String(localAppointmentId) });
  if (existing) return existing;
  try {
    return await PMSSyncRecord.create({
      practiceId,
      localAppointmentId: String(localAppointmentId),
      externalAppointmentId: String(externalAppointmentId),
      externalPatientId: externalPatientId != null ? String(externalPatientId) : null,
      provider,
      syncStatus: 'linked',
    });
  } catch (err) {
    if (err.code === 11000) {
      // Lost a create race against another request for the same local
      // appointment — the other request's record is now authoritative.
      return PMSSyncRecord.findOne({ practiceId, localAppointmentId: String(localAppointmentId) });
    }
    throw err;
  }
}

async function findByLocalAppointmentId(practiceId, localAppointmentId) {
  return PMSSyncRecord.findOne({ practiceId, localAppointmentId: String(localAppointmentId) });
}

async function findByExternalAppointmentId(practiceId, externalAppointmentId) {
  return PMSSyncRecord.findOne({ practiceId, externalAppointmentId: String(externalAppointmentId) });
}

async function updateStatus(practiceId, localAppointmentId, syncStatus) {
  return PMSSyncRecord.findOneAndUpdate(
    { practiceId, localAppointmentId: String(localAppointmentId) },
    { syncStatus, updatedAt: new Date(), lastSyncedAt: new Date() },
    { new: true }
  );
}

module.exports = { linkAppointment, findByLocalAppointmentId, findByExternalAppointmentId, updateStatus };
