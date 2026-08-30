/**
 * Appointment data access, scoped by practiceId on every query.
 *
 * Routes and providers never import the Mongoose model directly — they
 * go through this repository. That's what makes the practiceId scoping
 * enforceable in one place instead of "remembered" in every route, and
 * it's the seam where a future move to Postgres/Supabase happens without
 * touching a single route (see docs/DATA_MODEL.md).
 */

const Appointment = require('../models/Appointment');

async function create(practiceId, data) {
  const appointment = new Appointment({ ...data, practiceId });
  await appointment.save();
  return appointment;
}

async function findById(practiceId, id) {
  return Appointment.findOne({ _id: id, practiceId });
}

async function findByDate(practiceId, date, { excludeCancelled = true } = {}) {
  const query = { practiceId, date };
  if (excludeCancelled) query.status = { $ne: 'Cancelled' };
  return Appointment.find(query);
}

async function findByPhone(practiceId, phone, { excludeCancelled = true } = {}) {
  const query = { practiceId, phone };
  if (excludeCancelled) query.status = { $ne: 'Cancelled' };
  return Appointment.find(query).sort({ confirmedAt: -1 });
}

async function findAll(practiceId) {
  return Appointment.find({ practiceId }).sort({ confirmedAt: -1 });
}

async function update(practiceId, id, patch) {
  const appointment = await Appointment.findOne({ _id: id, practiceId });
  if (!appointment) return null;
  Object.assign(appointment, patch, { updatedAt: new Date() });
  await appointment.save();
  return appointment;
}

module.exports = { create, findById, findByDate, findByPhone, findAll, update };
