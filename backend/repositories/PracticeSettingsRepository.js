/**
 * Practice settings overrides, scoped by practiceId — same one-repository-
 * per-collection convention as every other entity in this codebase.
 */

const PracticeSettings = require('../models/PracticeSettings');

async function get(practiceId) {
  return PracticeSettings.findOne({ practiceId }).lean();
}

async function upsert(practiceId, sanitizedPatch, adminId) {
  const update = { ...sanitizedPatch, updatedBy: adminId || null };
  return PracticeSettings.findOneAndUpdate(
    { practiceId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

module.exports = { get, upsert };
