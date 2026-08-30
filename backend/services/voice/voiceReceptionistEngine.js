/**
 * Voice channel orchestrator — the ONLY thing routes/voice.js talks to.
 *
 * This ties together, in the exact priority order the Phase 4 spec
 * demands:
 *   1. The deterministic emergency check (services/emergencyService.js),
 *      ALWAYS run first, on every single utterance, even mid-booking-flow.
 *      A caller who says "I can't breathe" while in the middle of picking
 *      an appointment time must never have that swallowed by the booking
 *      state machine — see services/voice/voiceBookingFlow.js's header
 *      comment, which documents this exact rule and names this file as
 *      the only caller responsible for enforcing it.
 *   2. If a structured flow (book/cancel/reschedule) is already in
 *      progress for this call, the utterance goes straight to
 *      services/voice/voiceBookingFlow.js's continueFlow() — NOT back
 *      through the AI. A caller answering "Friday" or "yes" to a flow
 *      question is not a fresh AI turn; it is a deterministic answer to
 *      a deterministic question.
 *   3. Otherwise, the utterance goes through the SAME shared
 *      services/receptionistEngine.js the web chat channel uses, so FAQ/
 *      pricing/hours/insurance/general conversation and the AI's own
 *      intent classification are identical between web and voice — no
 *      second copy of that logic exists (Phase 4 spec §1).
 *   4. If that shared engine detects book_appointment/reschedule/cancel,
 *      voiceBookingFlow.startFlow() takes over immediately, since a phone
 *      call has no clickable booking UI to hand off to (unlike web).
 *   5. If it detects human_handoff, this file — not the AI, not the
 *      shared engine — is what actually creates the real handoff record
 *      and tells routes/voice.js to transfer the call. On the web
 *      channel this same intent only shows a UI button the caller would
 *      have to click; a phone call has no button, so the transfer must
 *      happen immediately.
 *
 * Every dependency is overridable via `deps` (mirrors
 * services/auth/loginService.js and services/receptionistEngine.js), so
 * this whole orchestration is unit-testable without a real database, AI
 * key, or Twilio account — see tests/voiceReceptionistEngine.test.js.
 *
 * IMPORTANT, honest limitation (documented rather than hidden): the
 * reply text produced by voiceBookingFlow.js is hard-coded English.
 * Caller intent inside a flow ("Friday", "yes", "2pm") is already
 * understood in English, Urdu-script, and Roman Urdu (see
 * naturalDateTimeParser.js and voiceBookingFlow.js's YES/NO/handoff
 * patterns), but the flow's own spoken PROMPTS ("What day would you like
 * to come in?") are English-only today. For that reason this file always
 * reports `language: 'en'` for flow-driven and emergency replies
 * (those strings are genuinely English), and only reports the AI's own
 * detected language for general/FAQ replies that actually came from the
 * shared AI-driven engine. Extending the flow's prompts to Urdu/Roman
 * Urdu is real future work, not something to silently claim is done.
 */

const conversationRepository = require('../../repositories/ConversationRepository');
const analyticsRepository = require('../../repositories/AnalyticsRepository');
const emergencyService = require('../emergencyService');
const receptionistEngine = require('../receptionistEngine');
const voiceBookingFlow = require('./voiceBookingFlow');
const tools = require('../../tools/receptionistTools');

const INTENT_TO_FLOW_ACTION = {
  book_appointment: 'book',
  reschedule: 'reschedule',
  cancel: 'cancel',
};

function clearFlowFields(slots) {
  Object.assign(slots, {
    voicePendingAction: null,
    voiceStep: null,
    voiceTargetAppointmentId: null,
    voiceResolvedDate: null,
    voiceResolvedTime: null,
    voiceStepAttempts: 0,
  });
}

/**
 * Handles exactly one caller utterance for one in-progress call.
 *
 * @param {object} params
 * @param {object} params.practice - resolved practice config (already
 *   identified from the CALLED number by middleware/voicePracticeContext.js
 *   — this file never trusts a client-supplied practiceId, per spec §5).
 * @param {string} params.conversationId - the call's own session id
 *   (Twilio CallSid), used as the conversationStore key exactly the way
 *   web uses its own conversationId. Never shared with a web session.
 * @param {string} params.callerPhone - the caller's phone number (Twilio
 *   "From"), used for identifying the caller's own appointments and as
 *   the contact number for a created appointment/handoff — never asked
 *   of the caller and never trusted from anything other than the signed
 *   telephony webhook payload.
 * @param {string} params.utteranceText - the transcribed caller speech
 *   for this turn (empty string/undefined if speech recognition heard
 *   nothing — callers should be re-prompted, not have that treated as a
 *   real answer).
 * @returns {{reply: string, replyUr: string|null, transfer: boolean,
 *   hangup: boolean, language: string, intent: string, urgency: string}}
 */
async function handleTurn({ practice, conversationId, callerPhone, utteranceText }, deps = {}) {
  const convRepo = deps.conversationRepository || conversationRepository;
  const analytics = deps.analyticsRepository || analyticsRepository;
  const emergency = deps.emergencyService || emergencyService;
  const engine = deps.receptionistEngine || receptionistEngine;
  const bookingFlow = deps.voiceBookingFlow || voiceBookingFlow;

  const conv = convRepo.getConversation(practice.practiceId, conversationId);
  const text = utteranceText || '';

  // --- 1. Deterministic emergency check — ALWAYS first, regardless of
  // whether a booking flow is currently in progress. ---
  const keywordUrgency = emergency.classifyUrgency(text);
  if (keywordUrgency === 'life_threatening') {
    if (conv.slots.voicePendingAction) clearFlowFields(conv.slots);
    try {
      if (text) convRepo.appendMessage(practice.practiceId, conversationId, 'user', text);
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', emergency.LIFE_THREATENING_MESSAGE_EN);
      convRepo.updateSlots(practice.practiceId, conversationId, { urgency: 'life_threatening' });
    } catch (err) {
      console.error('voiceReceptionistEngine: failed to persist emergency turn (non-fatal):', err.message);
    }
    try {
      await analytics.logEvent(practice.practiceId, 'emergency_request', conversationId, {
        severity: 'life_threatening', source: 'keyword', channel: 'voice',
      });
    } catch (err) {
      // analyticsRepository already swallows its own errors; this catch
      // only guards against a fully-mocked `deps.analyticsRepository` in
      // tests throwing synchronously.
    }
    return {
      reply: emergency.LIFE_THREATENING_MESSAGE_EN,
      replyUr: emergency.LIFE_THREATENING_MESSAGE_UR,
      intent: 'emergency',
      urgency: 'life_threatening',
      transfer: false,
      hangup: false,
      language: 'en',
    };
  }

  // --- 2. A structured flow is already in progress: the AI is bypassed
  // entirely: only voiceBookingFlow's own deterministic parsers interpret
  // this utterance (see this file's header comment for why). ---
  if (conv.slots.voicePendingAction) {
    const flowResult = await bookingFlow.continueFlow({
      practice, conv, utteranceText: text, callerPhone, conversationId, deps,
    });
    return {
      reply: flowResult.reply,
      replyUr: null,
      intent: 'voice_flow',
      urgency: conv.slots.urgency || 'none',
      transfer: !!flowResult.transfer,
      hangup: false,
      language: 'en', // flow prompts are English-only today — see header comment
    };
  }

  // --- 3. No flow in progress: run the SAME shared AI-driven engine the
  // web channel uses, for FAQ/pricing/hours/insurance/general/emergency
  // (AI-detected)/human_handoff classification. ---
  const result = await engine.understand({ practice, conversationId, message: text, channel: 'voice' }, deps);

  // Life-threatening is already handled above via the keyword check, but
  // the shared engine can ALSO surface it (e.g. the AI itself recognized
  // emergency language the keyword list missed) — treat that the same way.
  if (result.intent === 'emergency' && result.urgency === 'life_threatening') {
    return {
      reply: result.reply,
      replyUr: result.replyUr,
      intent: 'emergency',
      urgency: 'life_threatening',
      transfer: false,
      hangup: false,
      language: 'en',
    };
  }

  // --- 4. Hand off to the deterministic booking flow immediately — a
  // phone call has no booking UI to defer to the way web does. ---
  const flowAction = INTENT_TO_FLOW_ACTION[result.intent];
  if (flowAction) {
    const flowResult = await bookingFlow.startFlow({
      practice, action: flowAction, conv, callerPhone, conversationId, deps,
    });
    // The shared engine already logged the AI's own turn to history above;
    // this appends the flow's actual first spoken question as its own
    // turn so the call transcript honestly reflects what was really said
    // to the caller (never overwrites or hides the AI's turn — see this
    // file's header comment on this deliberate, documented tradeoff).
    try {
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', flowResult.reply);
    } catch (err) {
      console.error('voiceReceptionistEngine: failed to persist flow-start turn (non-fatal):', err.message);
    }
    return {
      reply: flowResult.reply,
      replyUr: null,
      intent: result.intent,
      urgency: result.urgency,
      transfer: false,
      hangup: false,
      language: 'en',
    };
  }

  // --- 5. Human handoff: unlike web (where this intent only shows a
  // button the caller would click), a phone call must transfer NOW. ---
  if (result.intent === 'human_handoff') {
    const handoffTool = deps.request_human_handoff || tools.request_human_handoff;
    try {
      await handoffTool(practice, {
        conversationId,
        reason: 'requested_staff',
        type: 'call_office',
        phone: callerPhone,
        urgency: result.urgency,
      });
    } catch (err) {
      console.error('voiceReceptionistEngine: failed to log human handoff request (non-fatal):', err.message);
    }
    return {
      reply: result.reply,
      replyUr: result.replyUr,
      intent: 'human_handoff',
      urgency: result.urgency,
      transfer: true,
      hangup: false,
      language: result.language || 'en',
    };
  }

  // --- 6. Ordinary FAQ/pricing/hours/insurance/general/urgent-fallback
  // reply — pass the shared engine's own result straight through. ---
  return {
    reply: result.reply,
    replyUr: result.replyUr,
    intent: result.intent,
    urgency: result.urgency,
    transfer: false,
    hangup: false,
    language: result.language || 'en',
  };
}

module.exports = { handleTurn };
