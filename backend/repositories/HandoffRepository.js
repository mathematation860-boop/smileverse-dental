const HandoffRequest = require('../models/HandoffRequest');

async function create(practiceId, data) {
  const handoff = new HandoffRequest({ ...data, practiceId });
  await handoff.save();
  return handoff;
}

async function findAll(practiceId) {
  return HandoffRequest.find({ practiceId }).sort({ createdAt: -1 });
}

module.exports = { create, findAll };
