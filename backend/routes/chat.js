/**
 * Web chat channel adapter.
 *
 * As of Phase 4 this file no longer contains the actual "understand this
 * message" logic — that now lives in services/receptionistEngine.js,
 * shared with the voice channel (see routes/voice.js). This file's job is
 * only: validate the HTTP request, call the shared engine, and shape the
 * JSON response exactly the way it always has (the frontend depends on
 * these exact field names/shapes, so they're preserved 1:1 across this
 * refactor).
 */

const express = require('express');
const receptionistEngine = require('../services/receptionistEngine');
const { enforceMaxLengths } = require('../middleware/validate');

const router = express.Router();

router.post('/chat', enforceMaxLengths(['chatMessage']), async (req, res) => {
  const message = req.body.message;
  const conversationId = req.body.conversationId;
  if (!message || !conversationId) {
    return res.status(400).json({ error: 'conversationId and message are required' });
  }

  try {
    const result = await receptionistEngine.understand({
      practice: req.practice,
      conversationId,
      message,
      channel: 'web',
    });

    // Life-threatening emergency: same 200 success-shaped payload the
    // frontend has always rendered directly (see LIFE_THREATENING branch
    // in the pre-Phase-4 version of this file).
    if (result.intent === 'emergency' && result.urgency === 'life_threatening') {
      return res.json({
        success: true,
        message: result.reply,
        reply: result.reply,
        replyUr: result.replyUr,
        conversationId,
        intent: 'emergency',
        urgency: 'life_threatening',
        suggestedActions: result.suggestedActions,
        entities: result.entities,
      });
    }

    if (result.aiFailed) {
      const isUrgent = result.urgency === 'urgent' || result.urgency === 'severe';
      if (!isUrgent) {
        // Ordinary chit-chat failure: keep the existing generic behavior.
        // The frontend's api.js treats any non-2xx response as a thrown
        // error and only ever shows a fixed generic message for it.
        console.error('Chat API Error: receptionist engine failed (non-urgent)');
        return res.status(500).json({ error: 'Failed to process message' });
      }

      // Urgent (but not life-threatening) dental issue + AI outage:
      // respond with a real 200 success-shaped payload so the frontend
      // actually renders the safety-aware reply.
      return res.json({
        success: true,
        message: result.reply,
        reply: result.reply,
        replyUr: result.replyUr,
        conversationId,
        intent: 'emergency',
        urgency: result.urgency,
        suggestedActions: result.suggestedActions,
        entities: result.entities,
      });
    }

    res.json({
      success: true,
      message: result.reply, // backward-compatible field name
      reply: result.reply,
      conversationId,
      intent: result.intent,
      urgency: result.urgency,
      suggestedActions: result.suggestedActions,
      entities: result.entities,
    });
  } catch (error) {
    // receptionistEngine.understand() already catches AI/provider errors
    // internally and returns an `aiFailed` result rather than throwing —
    // this catch is a last-resort net for anything else (e.g. a bug in
    // this route's own JSON-shaping above).
    console.error('Chat API Error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

module.exports = router;
