const express = require('express');
const conversationRepository = require('../repositories/ConversationRepository');
const analyticsRepository = require('../repositories/AnalyticsRepository');
const emergencyService = require('../services/emergencyService');
const { getAIProvider } = require('../services/ai');
const { enforceMaxLengths } = require('../middleware/validate');

const router = express.Router();

router.post('/chat', enforceMaxLengths(['chatMessage']), async (req, res) => {
  // Declared outside the try block so the catch block below can still see
  // the deterministic keyword classification even if the AI call itself is
  // what throws (see the QA-audit comment in the catch block).
  let conversationId;
  let keywordUrgency = 'none';
  let message;

  try {
    message = req.body.message;
    conversationId = req.body.conversationId;
    if (!message || !conversationId) {
      return res.status(400).json({ error: 'conversationId and message are required' });
    }

    const practice = req.practice;
    const conv = conversationRepository.getConversation(practice.practiceId, conversationId);
    const isFirstMessage = conv.history.length === 0;

    // 1. Deterministic safety check FIRST, before any AI call.
    keywordUrgency = emergencyService.classifyUrgency(message);

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

    // QA-audit fix: an AI outage used to fall back to the same bland
    // "please try again" message regardless of what the patient actually
    // said. That is fine for ordinary chit-chat, but a patient with a
    // genuinely urgent (though not life-threatening) dental issue — severe
    // pain, a knocked-out tooth, facial swelling — deserves safety-aware
    // guidance even when the AI provider itself is unreachable. The
    // life-threatening tier already has its own dedicated safety net above
    // this try block; this covers the next tier down.
    const isUrgent = keywordUrgency === 'urgent' || keywordUrgency === 'severe';

    if (!isUrgent || !conversationId) {
      // Ordinary chit-chat failure: keep the existing generic behavior.
      // The frontend's api.js treats any non-2xx response as a thrown
      // error and only ever shows a fixed generic message for it, so an
      // extra `reply` field here would never reach the user anyway.
      return res.status(500).json({ error: 'Failed to process message' });
    }

    // Urgent (but not life-threatening) dental issue + AI outage: respond
    // with a real 200 success-shaped payload, exactly like the
    // life-threatening branch above, so the frontend actually renders the
    // safety-aware reply instead of silently discarding it (api.js's
    // request() only keeps the response body when res.ok is true).
    const fallbackReply = emergencyService.URGENT_FALLBACK_MESSAGE_EN;
    const fallbackReplyUr = emergencyService.URGENT_FALLBACK_MESSAGE_UR;

    try {
      if (message) {
        conversationRepository.appendMessage(req.practice.practiceId, conversationId, 'user', message);
      }
      conversationRepository.appendMessage(req.practice.practiceId, conversationId, 'assistant', fallbackReply);
      conversationRepository.updateSlots(req.practice.practiceId, conversationId, { urgency: keywordUrgency });
    } catch (historyErr) {
      // Even if we can't persist history, the patient must still get the
      // safety-aware reply below.
      console.error('Failed to persist urgent-fallback turn:', historyErr);
    }

    let entities = {};
    try {
      entities = conversationRepository.getConversation(req.practice.practiceId, conversationId).slots;
    } catch (slotErr) {
      // Fall back to an empty slots object rather than failing the response.
    }

    try {
      await analyticsRepository.logEvent(req.practice.practiceId, 'emergency_request', conversationId, {
        severity: keywordUrgency,
        source: 'keyword_fallback_on_ai_error',
      });
    } catch (logErr) {
      // Analytics must never compound an already-failing request.
    }

    return res.json({
      success: true,
      message: fallbackReply,
      reply: fallbackReply,
      replyUr: fallbackReplyUr,
      conversationId,
      intent: 'emergency',
      urgency: keywordUrgency,
      suggestedActions: ['talk_to_human'],
      entities,
    });
  }
});

module.exports = router;
