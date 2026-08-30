/**
 * PMSAuditLog data access, scoped by practiceId — see model header for
 * what this deliberately does and doesn't store.
 */

const PMSAuditLog = require('../models/PMSAuditLog');

async function record(practiceId, entry) {
  try {
    return await PMSAuditLog.create({ practiceId, ...entry });
  } catch (err) {
    // An audit-log write failure must never break the real operation it
    // was recording — log server-side and move on (same non-fatal
    // philosophy as notificationService.js's own logging).
    console.error('PMSAuditLogRepository.record failed (non-fatal):', err.message);
    return null;
  }
}

async function listForPractice(practiceId, { limit = 200 } = {}) {
  return PMSAuditLog.find({ practiceId }).sort({ createdAt: -1 }).limit(limit);
}

module.exports = { record, listForPractice };
