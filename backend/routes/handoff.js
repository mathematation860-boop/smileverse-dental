const express = require('express');
const tools = require('../tools/receptionistTools');
const conversationRepository = require('../repositories/ConversationRepository');
const { enforceMaxLengths } = require('../middleware/validate');

const router = express.Router();

// POST /api/handoff -> patient asked for (or was routed to) a human.
// type: 'call_office' | 'request_callback' | 'send_message'
router.post('/handoff', enforceMaxLengths(['name', 'phone', 'message']), async (req, res) => {
  try {
    const { conversationId, reason, type, name, phone, message } = req.body;

    if (type === 'request_callback' || type === 'send_message') {
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required for this handoff type' });
      }
    }

    // Real, not invented: whatever urgency this conversation already has on
    // record from the deterministic classifier/AI (see routes/chat.js) —
    // surfaced to the admin dashboard's handoff queue (Phase 3 §9).
    const urgency = conversationId
      ? conversationRepository.getConversation(req.practice.practiceId, conversationId).slots.urgency
      : undefined;

    const handoff = await tools.request_human_handoff(req.practice, { conversationId, reason, type, name, phone, message, urgency });

    res.json({
      success: true,
      data: handoff,
      officePhone: req.practice.phone,
      message:
        type === 'call_office'
          ? `You can reach our front desk directly at ${req.practice.phone}.`
          : "Thanks — our front desk team will follow up with you. This is a demo app, so no real staff member is being paged yet.",
    });
  } catch (error) {
    console.error('Handoff Error:', error);
    res.status(500).json({ error: 'Failed to submit handoff request' });
  }
});

module.exports = router;
