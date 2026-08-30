/**
 * The ONE receptionist intelligence core, shared by every conversational
 * channel (web chat today; voice as of Phase 4; SMS is a plausible future
 * channel). A channel adapter's job is only to turn its own I/O (an HTTP
 * JSON request, a Twilio voice webhook, an SMS payload) into a call to
 * `understand()` below, and turn the result back into that channel's own
 * response shape (JSON for web, TwiML for voice). See routes/chat.js and
 * services/voice/voiceReceptionistEngine.js for the two adapters that
 * exist today — neither duplicates this logic.
 *
 * This function owns:
 *   1. Deterministic emergency triage (services/emergencyService.js),
 *      which ALWAYS runs first and is NEVER skipped or made conditional
 *      on the AI provider being reachable.
 *   2. The AI understand-and-reply call (services/ai), including this
 *      practice's grounding (config/promptBuilder.js) and price-safety
 *      guard (baked into the AI provider itself).
 *   3. Conversation history/slot persistence
 *      (repositories/ConversationRepository.js) — identical storage for
 *      every channel, so a caller who starts on the web and later calls
 *      in (or vice versa) could, in principle, share one conversationId's
 *      slot memory.
 *   4. Urgency-aware analytics logging.
 *
 * This function deliberately does NOT execute any booking/cancel/
 * reschedule side effect — see tools/receptionistTools.js for those.
 * Each channel decides separately, and on its own schedule, when enough
 * information exists to actually call them: the web channel defers to a
 * deterministic UI form (BookingFlow) that calls the REST routes
 * directly; the voice channel (services/voice/voiceBookingFlow.js) walks
 * an explicit-confirmation state machine over multiple turns, since a
 * phone caller has no form to fill in.
 *
 * This module is a straight extraction of what routes/chat.js already
 * did — refactored out so it has exactly one implementation instead of
 * being copy-pasted for voice. routes/chat.js's own tests (there are
 * none directly, only unit tests on the modules it composes) and its
 * externally-observable response shape are both preserved by keeping
 * that file's own JSON-shaping logic in chat.js, and only moving the
 * shared "understand this message" behavior here.
 */

const conversationRepository = require('../repositories/ConversationRepository');
const analyticsRepository = require('../repositories/AnalyticsRepository');
const emergencyService = require('./emergencyService');
const { getAIProvider } = require('./ai');
const notificationService = require('./notifications/notificationService');

// Used only when the AI provider fails AND the deterministic keyword pass
// found nothing urgent — a plain "something went wrong" a voice caller can
// still be told out loud (the web channel ignores this text and shows its
// own generic error state instead; see routes/chat.js).
const GENERIC_AI_FAILURE_REPLY_EN =
  "I'm sorry, I'm having trouble understanding right now. Would you like me to connect you with our front desk team?";

/**
 * @param {object} params
 * @param {object} params.practice - resolved practice object (never trust one supplied by a caller)
 * @param {string} params.conversationId - stable id for this conversation's slot memory (a web session id, or a voice CallSid)
 * @param {string} params.message - the latest transcribed/typed patient message
 * @param {'web'|'voice'|'sms'} [params.channel] - purely for analytics payload metadata; never changes behavior
 * @param {object} [deps] - overridable for tests (see tests/receptionistEngine.test.js); defaults to the real modules imported above
 * @returns {Promise<{
 *   reply: string,
 *   replyUr: string|null,
 *   intent: string,
 *   urgency: 'none'|'moderate'|'urgent'|'severe'|'life_threatening',
 *   suggestedActions: string[],
 *   entities: object,
 *   language: 'en'|'ur',
 *   aiFailed: boolean,
 * }>}
 */
async function understand({ practice, conversationId, message, channel = 'web' }, deps = {}) {
  const convRepo = deps.conversationRepository || conversationRepository;
  const analytics = deps.analyticsRepository || analyticsRepository;
  const emergency = deps.emergencyService || emergencyService;
  const resolveAIProvider = deps.getAIProvider || getAIProvider;

  let keywordUrgency = 'none';

  try {
    const conv = convRepo.getConversation(practice.practiceId, conversationId);
    const isFirstMessage = conv.history.length === 0;

    // 1. Deterministic safety check FIRST, before any AI call — see
    // services/emergencyService.js's header comment on why this can never
    // be conditional on the AI being reachable.
    keywordUrgency = emergency.classifyUrgency(message);

    if (keywordUrgency === 'life_threatening') {
      convRepo.appendMessage(practice.practiceId, conversationId, 'user', message);
      const replyEn = emergency.LIFE_THREATENING_MESSAGE_EN;
      const replyUr = emergency.LIFE_THREATENING_MESSAGE_UR;
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', replyEn);
      convRepo.updateSlots(practice.practiceId, conversationId, { urgency: 'life_threatening' });

      await analytics.logEvent(practice.practiceId, 'emergency_request', conversationId, {
        severity: 'life_threatening',
        source: 'keyword',
        channel,
      });

      // Phase 5 spec §16: attempt a clinic alert ASYNCHRONOUSLY — this is
      // deliberately NOT awaited, so a slow/unreachable SMS or email
      // provider can never delay the patient's own emergency guidance
      // (which has already been fully computed above). notifyEmergencyClinicAlert
      // itself also never throws, so this can never surface as an
      // unhandled rejection either.
      const notify = deps.notificationService || notificationService;
      notify.notifyEmergencyClinicAlert(practice, { conversationId, channel }).catch(() => {});

      return {
        reply: replyEn,
        replyUr,
        intent: 'emergency',
        urgency: 'life_threatening',
        suggestedActions: ['talk_to_human'],
        entities: conv.slots,
        language: 'en',
        aiFailed: false,
      };
    }

    // 2. Understand + generate a reply via the AI provider, using
    // accumulated slot memory — identical call shape for every channel.
    const aiProvider = resolveAIProvider(practice);
    const historyForModel = conv.history.slice();
    const result = await aiProvider.understandAndReply({
      practice,
      message,
      history: historyForModel,
      slots: conv.slots,
    });

    // 3. Merge extracted entities into slot memory so later turns (on any
    // channel using this conversationId) don't re-ask.
    convRepo.updateSlots(practice.practiceId, conversationId, {
      serviceId: result.entities.serviceId,
      datePreference: result.entities.datePreference,
      patientType: result.entities.patientType,
      language: result.language,
    });

    // 4. Combine AI-perceived urgency with the deterministic keyword pass
    // (most severe wins).
    const finalUrgency = emergency.combineUrgency(keywordUrgency, result.entities.urgency);

    convRepo.appendMessage(practice.practiceId, conversationId, 'user', message);
    convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', result.reply);

    if (isFirstMessage) {
      await analytics.logEvent(practice.practiceId, 'conversation_started', conversationId, { channel });
    }
    if (result.intent === 'book_appointment') {
      await analytics.logEvent(practice.practiceId, 'appointment_requested', conversationId, {
        serviceId: result.entities.serviceId,
        channel,
      });
    }
    if (finalUrgency === 'severe' || finalUrgency === 'urgent' || result.intent === 'emergency') {
      await analytics.logEvent(practice.practiceId, 'emergency_request', conversationId, {
        severity: finalUrgency,
        source: 'ai',
        channel,
      });
      // Same asynchronous, non-blocking clinic alert as the keyword path
      // above — only for genuinely life-threatening severity (an "urgent"
      // dental issue like a bad toothache is a same-day-booking case, not
      // a clinic-paging emergency).
      if (finalUrgency === 'life_threatening') {
        const notify = deps.notificationService || notificationService;
        notify.notifyEmergencyClinicAlert(practice, { conversationId, channel }).catch(() => {});
      }
    }
    if (result.intent === 'human_handoff') {
      await analytics.logEvent(practice.practiceId, 'human_handoff_requested', conversationId, {
        source: `${channel}_intent`,
      });
    }

    return {
      reply: result.reply,
      replyUr: null,
      intent: result.intent,
      urgency: finalUrgency,
      suggestedActions: result.suggestedActions,
      entities: convRepo.getConversation(practice.practiceId, conversationId).slots,
      language: result.language,
      aiFailed: false,
    };
  } catch (error) {
    console.error('receptionistEngine.understand: AI/provider error —', error.message);

    // Same QA-audit fix chat.js has always had: a genuinely urgent (but not
    // life-threatening) dental issue deserves safety-aware guidance even
    // when the AI provider itself is unreachable — never the same bland
    // "please try again" message a random chit-chat failure would get.
    const isUrgent = keywordUrgency === 'urgent' || keywordUrgency === 'severe';
    const fallbackReply = isUrgent ? emergency.URGENT_FALLBACK_MESSAGE_EN : GENERIC_AI_FAILURE_REPLY_EN;
    const fallbackReplyUr = isUrgent ? emergency.URGENT_FALLBACK_MESSAGE_UR : null;

    try {
      if (message) {
        convRepo.appendMessage(practice.practiceId, conversationId, 'user', message);
      }
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', fallbackReply);
      if (isUrgent) {
        convRepo.updateSlots(practice.practiceId, conversationId, { urgency: keywordUrgency });
      }
    } catch (historyErr) {
      // Even if we can't persist history, the caller must still get a reply.
      console.error('receptionistEngine: failed to persist fallback turn:', historyErr.message);
    }

    let entities = {};
    try {
      entities = convRepo.getConversation(practice.practiceId, conversationId).slots;
    } catch (slotErr) {
      // Fall back to an empty slots object rather than failing the response.
    }

    if (isUrgent) {
      try {
        await analytics.logEvent(practice.practiceId, 'emergency_request', conversationId, {
          severity: keywordUrgency,
          source: 'keyword_fallback_on_ai_error',
          channel,
        });
      } catch (logErr) {
        // Analytics must never compound an already-failing request.
      }
    }

    return {
      reply: fallbackReply,
      replyUr: fallbackReplyUr,
      intent: isUrgent ? 'emergency' : 'general',
      urgency: isUrgent ? keywordUrgency : 'none',
      suggestedActions: isUrgent ? ['talk_to_human'] : ['none'],
      entities,
      language: 'en',
      aiFailed: true,
    };
  }
}

module.exports = { understand, GENERIC_AI_FAILURE_REPLY_EN };
