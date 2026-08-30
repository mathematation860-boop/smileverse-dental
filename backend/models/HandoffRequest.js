const mongoose = require('mongoose');

const handoffRequestSchema = new mongoose.Schema({
  conversationId: String,
  reason: String, // e.g. 'clinical_question', 'complaint', 'insurance', 'billing', 'requested_staff', 'uncertain', 'urgent'
  type: { type: String, enum: ['call_office', 'request_callback', 'send_message'], default: 'request_callback' },
  name: String,
  phone: String,
  message: String,
  status: { type: String, enum: ['open', 'resolved'], default: 'open' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.HandoffRequest || mongoose.model('HandoffRequest', handoffRequestSchema);
