const mongoose = require('mongoose');

const handoffRequestSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  conversationId: String,
  reason: String, // e.g. 'clinical_question', 'complaint', 'insurance', 'billing', 'requested_staff', 'uncertain', 'urgent'
  type: { type: String, enum: ['call_office', 'request_callback', 'send_message'], default: 'request_callback' },
  name: String,
  phone: String,
  message: String,
  // Phase 3: three-state admin workflow (pending -> assigned -> resolved).
  // 'open' is kept in the enum only so any pre-Phase-3 documents already
  // saved with that value still pass validation on read/re-save; new
  // documents always start at 'pending' — see
  // repositories/HandoffRepository.js normalizeStatus() for how 'open' is
  // displayed to the admin dashboard as 'pending'.
  status: { type: String, enum: ['open', 'pending', 'assigned', 'resolved'], default: 'pending' },
  urgency: { type: String, enum: ['normal', 'urgent', 'life_threatening'], default: 'normal' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.HandoffRequest || mongoose.model('HandoffRequest', handoffRequestSchema);
