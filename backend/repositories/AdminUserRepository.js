/**
 * Admin account data access — every query scoped by practiceId, same
 * rule as every other repository in this codebase (see
 * AppointmentRepository.js). The one exception is `findById`, used only
 * by authMiddleware to re-check an already-authenticated admin's own
 * record (practiceId there comes from the verified session token, not
 * from client input, so there is no isolation gap).
 */

const AdminUser = require('../models/AdminUser');

/** Looks up an admin by email WITHIN one practice. Includes passwordHash — callers must never forward this document to a response. */
async function findByEmailForLogin(practiceId, email) {
  return AdminUser.findOne({ practiceId, email: String(email || '').toLowerCase() }).select('+passwordHash');
}

/** Re-fetches an authenticated admin by id, scoped to the practiceId the session claims. Returns null if the id/practiceId pair doesn't match (e.g. a stale token for a deleted account). */
async function findByIdInPractice(practiceId, adminId) {
  return AdminUser.findOne({ _id: adminId, practiceId });
}

async function create(practiceId, { name, email, passwordHash, role }) {
  const admin = new AdminUser({
    practiceId,
    name,
    email: String(email || '').toLowerCase(),
    passwordHash,
    role: role === 'super_admin' ? 'super_admin' : 'practice_admin',
  });
  await admin.save();
  return admin;
}

async function markLoginSuccessful(adminId) {
  await AdminUser.updateOne({ _id: adminId }, { $set: { lastLoginAt: new Date() } });
}

async function findAllForPractice(practiceId) {
  return AdminUser.find({ practiceId }).sort({ createdAt: 1 });
}

module.exports = { findByEmailForLogin, findByIdInPractice, create, markLoginSuccessful, findAllForPractice };
