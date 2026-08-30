const express = require('express');
const conversationStore = require('../services/conversationStore');
const emergencyService = require('../services/emergencyService');
const intentService = require('../services/intentService');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

router.post('/chat', async (req, res) => {
  try {
    const { conversationId, message } = req.body;
    if (!message || !conversationId) {
      return res.status(400).json({ error: 'conversationId and message are required' });
    }

    const conv = conversationStore.getConversation(conversationId);
    const isFirstMessage = conv.history.length === 0;

    // 1. Deterministic safety check FIRST, before any AI call.
    const keywordUrgency = emergencyService.classifyUrgency(message);

    if (keywordUrgency === 'life_threatening') {
      conversationStore.appendMessage(conversationId, 'user', message);
      const safetyReplyEn = emergencyService.LIFE_THREATENING_MESSAGE_EN;
      conversationStore.appendMessage(conversationId, 'assistant', safetyReplyEn);
      conversationStore.updateSlots(conversationId, { urgency: 'life_threatening' });

      await analyticsService.logEvent('emergency_request', conversationId, { severity: 'life_threatening', source: 'keyword' });

      return res.json({
        success: true,
        message: safetyReplyEn,
        reply: safetyReplyEn,
        replyUr: emergencyService.LIFE_THREATENING_MESSAGE_UR,
        conversationId,
        intent: 'emergency',
        urgency: 'life_threatening',
        suggestedActions: ['talk_to_human'],
        entities: conv.slots,
      });
    }

    // 2. Understand + generate a reply via the AI, using accumulated slot memory.
    const historyForModel = conv.history.slice();
    const result = await intentService.understandAndReply({
      message,
      history: historyForModel,
      slots: conv.slots,
    });

    // 3. Merge extracted entities into slot memory so later turns don't re-ask.
    conversationStore.updateSlots(conversationId, {
      serviceId: result.entities.serviceId,
      datePreference: result.entities.datePreference,
      patientType: result.entities.patientType,
      language: result.language,
    });

    // 4. Combine AI-perceived urgency with the deterministic keyword pass (most severe wins).
    const finalUrgency = emergencyService.combineUrgency(keywordUrgency, result.entities.urgency);

    conversationStore.appendMessage(conversationId, 'user', message);
    conversationStore.appendMessage(conversationId, 'assistant', result.reply);

    if (isFirstMessage) {
      await analyticsService.logEvent('conversation_started', conversationId, {});
    }
    if (result.intent === 'book_appointment') {
      await analyticsService.logEvent('appointment_requested', conversationId, { serviceId: result.entities.serviceId });
    }
    if (finalUrgency === 'severe' || finalUrgency === 'urgent' || result.intent === 'emergency') {
      await analyticsService.logEvent('emergency_request', conversationId, { severity: finalUrgency, source: 'ai' });
    }
    if (result.intent === 'human_handoff') {
      await analyticsService.logEvent('human_handoff_requested', conversationId, { source: 'chat_intent' });
    }

    res.json({
      success: true,
      message: result.reply, // backward-compatible field name
      reply: result.reply,
      conversationId,
      intent: result.intent,
      urgency: finalUrgency,
      suggestedActions: result.suggestedActions,
      entities: conversationStore.getConversation(conversationId).slots,
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error.message,
    });
  }
});

module.exports = router;
