const HandoffRequest = require('../models/HandoffRequest');

async function create(practiceId, data) {
  const handoff = new HandoffRequest({ ...data, practiceId });
  await handoff.save();
  return handoff;
}

/** Legacy pre-Phase-3 rows were saved with status 'open' — displayed to the admin dashboard as 'pending' (see models/HandoffRequest.js). Never mutates the stored value; this is a read-time display mapping only. */
function normalizeStatus(status) {
  return status === 'open' ? 'pending' : status;
}

async function findAll(practiceId) {
  const rows = await HandoffRequest.find({ practiceId }).sort({ createdAt: -1 });
  return rows.map((r) => Object.assign(r, { status: normalizeStatus(r.status) }));
}

async function findById(practiceId, id) {
  const row = await HandoffRequest.findOne({ _id: id, practiceId });
  if (!row) return null;
  row.status = normalizeStatus(row.status);
  return row;
}

/** Practice-scoped status update — the ONLY way the admin dashboard changes a handoff's status (Phase 3 §9: pending/assigned/resolved). */
async function updateStatus(practiceId, id, status) {
  if (!['pending', 'assigned', 'resolved'].includes(status)) return null;
  const row = await HandoffRequest.findOne({ _id: id, practiceId });
  if (!row) return null;
  row.status = status;
  row.updatedAt = new Date();
  await row.save();
  return row;
}

module.exports = { create, findAll, findById, updateStatus, normalizeStatus };
