const express = require('express');
const conversationRepository = require('../repositories/ConversationRepository');
const analyticsRepository = require('../repositories/AnalyticsRepository');
const emergencyService = require('../services/emergencyService');
const { getAIProvider } = require('../services/ai');
const { enforceMaxLengths } = require('../middleware/validate');

const router = express.Router();

router.post('/chat', enforceMaxLengths(['chatMessage']), async (req, res) => {
  try {
    const { conversationId, message } = req.body;
    if (!message || !conversationId) {
      return res.status(400).json({ error: 'conversationId and message are required' });
    }

    const practice = req.practice;
    const conv = conversationRepository.getConversation(practice.practiceId, conversationId);
    const isFirstMessage = conv.history.length === 0;

    // 1. Deterministic safety check FIRST, before any AI call.
    const keywordUrgency = emergencyService.classifyUrgency(message);

    if (keywordUrgency === 'life_threatening') {
      conversationRepository.appendMessage(practice.practiceId, conversationId, 'user', message);
      const safetyReplyEn = emergencyService.LIFE_THREATENING_MESSAGE_EN;
      conversationRepository.appendMessage(practice.practiceId, conversationId, 'assistant', safetyReplyEn);
      conversationRepository.updateSlots(practice.practiceId, conversationId, { urgency: 'life_threatening' });

      await analyticsRepository.logEvent(practice.practiceId, 'emergency_request', conversationId, {
        severity: 'life_threatening',
        source: 'keyword',
      });

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

    // 2. Understand + generate a reply via the AI provider, using accumulated slot memory.
    const aiProvider = getAIProvider(practice);
    const historyForModel = conv.history.slice();
    const result = await aiProvider.understandAndReply({
      practice,
      message,
      history: historyForModel,
      slots: conv.slots,
    });

    // 3. Merge extracted entities into slot memory so later turns don't re-ask.
    conversationRepository.updateSlots(practice.practiceId, conversationId, {
      serviceId: result.entities.serviceId,
      datePreference: result.entities.datePreference,
      patientType: result.entities.patientType,
      language: result.language,
    });

    // 4. Combine AI-perceived urgency with the deterministic keyword pass (most severe wins).
    const finalUrgency = emergencyService.combineUrgency(keywordUrgency, result.entities.urgency);

    conversationRepository.appendMessage(practice.practiceId, conversationId, 'user', message);
    conversationRepository.appendMessage(practice.practiceId, conversationId, 'assistant', result.reply);

    if (isFirstMessage) {
      await analyticsRepository.logEvent(practice.practiceId, 'conversation_started', conversationId, {});
    }
    if (result.intent === 'book_appointment') {
      await analyticsRepository.logEvent(practice.practiceId, 'appointment_requested', conversationId, {
        serviceId: result.entities.serviceId,
      });
    }
    if (finalUrgency === 'severe' || finalUrgency === 'urgent' || result.intent === 'emergency') {
      await analyticsRepository.logEvent(practice.practiceId, 'emergency_request', conversationId, {
        severity: finalUrgency,
        source: 'ai',
      });
    }
    if (result.intent === 'human_handoff') {
      await analyticsRepository.logEvent(practice.practiceId, 'human_handoff_requested', conversationId, { source: 'chat_intent' });
    }

    res.json({
      success: true,
      message: result.reply, // backward-compatible field name
      reply: result.reply,
      conversationId,
      intent: result.intent,
      urgency: finalUrgency,
      suggestedActions: result.suggestedActions,
      entities: conversationRepository.getConversation(practice.practiceId, conversationId).slots,
    });
  } catch (error) {
    // Log the real error server-side, but never leak internal error details
    // (stack traces, provider error text) to the client.
    console.error('Chat API Error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      reply: "Sorry, I'm having trouble right now. Please call our office or request a callback.",
    });
  }
});

module.exports = router;
