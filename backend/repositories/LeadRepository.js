const Lead = require('../models/Lead');

async function create(practiceId, data) {
  const lead = new Lead({ ...data, practiceId });
  await lead.save();
  return lead;
}

async function findAll(practiceId) {
  return Lead.find({ practiceId }).sort({ savedAt: -1 });
}

module.exports = { create, findAll };
