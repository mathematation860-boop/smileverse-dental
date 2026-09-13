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
const { resolveConversationToken } = require('../services/conversations/conversationToken');

const router = express.Router();

router.post('/chat', enforceMaxLengths(['chatMessage']), async (req, res) => {
  const message = req.body.message;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Which conversation this is may ONLY come from a token this server
  // issued and signed. The widget used to choose the id itself, from
  // Date.now() — an enumerable value that let anyone reach another
  // patient's stored history and slots through the assistant's own reply.
  // A missing or forged token is replaced with a fresh, empty
  // conversation rather than rejected: no error for a stale bundle, and
  // no oracle for someone probing. See
  // services/conversations/conversationToken.js.
  const { token: conversationToken, conversationId } = resolveConversationToken(
    req.body.conversationToken || req.body.conversationId
  );

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
        conversationToken,
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
        conversationToken,
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
      conversationToken,
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
