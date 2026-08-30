const express = require('express');
const HandoffRequest = require('../models/HandoffRequest');
const analyticsService = require('../services/analyticsService');
const practiceConfig = require('../config/practiceConfig');

const router = express.Router();

// POST /api/handoff -> patient asked for (or was routed to) a human.
// type: 'call_office' | 'request_callback' | 'send_message'
router.post('/handoff', async (req, res) => {
  try {
    const { conversationId, reason, type, name, phone, message } = req.body;

    if (type === 'request_callback' || type === 'send_message') {
      if (!phone) {
        return res.status(400).json({ error: 'Phone number is required for this handoff type' });
      }
    }

    const handoff = await HandoffRequest.create({
      conversationId,
      reason: reason || 'uncertain',
      type: type || 'request_callback',
      name,
      phone,
      message,
    });

    await analyticsService.logEvent('human_handoff_requested', conversationId, { reason, type });

    res.json({
      success: true,
      data: handoff,
      officePhone: practiceConfig.phone,
      message:
        type === 'call_office'
          ? `You can reach our front desk directly at ${practiceConfig.phone}.`
          : "Thanks — our front desk team will follow up with you. This is a demo app, so no real staff member is being paged yet.",
    });
  } catch (error) {
    console.error('Handoff Error:', error);
    res.status(500).json({ error: 'Failed to submit handoff request' });
  }
});

module.exports = router;
