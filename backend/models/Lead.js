const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  name: String,
  email: String,
  phone: String,
  message: String,
  savedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
