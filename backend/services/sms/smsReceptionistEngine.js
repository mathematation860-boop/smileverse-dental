/**
 * SMS channel orchestrator (Phase 5 spec §11: "the inbound SMS should
 * eventually route through the same receptionist logic as web/voice ...
 * it MUST reuse the existing AI/receptionist tools rather than creating a
 * separate AI").
 *
 * This deliberately reuses the exact same building blocks Phase 4 already
 * built for voice, rather than writing a third copy of "how do I detect an
 * emergency" / "how do I walk someone through booking":
 *   - services/emergencyService.js + services/receptionistEngine.js for
 *     the deterministic safety check and FAQ/general/AI-driven intent
 *     classification — the SAME shared core web and voice already use.
 *   - services/voice/voiceBookingFlow.js for the deterministic multi-turn
 *     book/cancel/reschedule state machine. This module is not actually
 *     voice-specific — it operates purely on transcribed/typed text in,
 *     spoken/written text out (see that file's own functions: they take
 *     `utteranceText` and return `{ reply }}`, nothing audio-specific) —
 *     so reusing it for SMS is genuine architecture reuse, not a
 *     name-only coincidence. It reuses the SAME conversation slot fields
 *     (voicePendingAction/voiceStep/...) since an SMS conversationId
 *     ("sms:+1555...") can never collide with a voice CallSid.
 *   - tools/receptionistTools.js for every actual side effect (booking,
 *     cancelling, rescheduling, human handoff) — exactly one
 *     implementation of each, per Phase 4/5's "do not duplicate" rule.
 *
 * Unlike voice, SMS has no "transfer the call" concept — when a flow
 * escalates to a human, this just means "reply that the front desk will
 * follow up" (the handoff record + clinic notification already happened
 * inside voiceBookingFlow/receptionistTools) — there is nothing to Dial.
 */

const conversationRepository = require('../../repositories/ConversationRepository');
const emergencyService = require('../emergencyService');
const receptionistEngine = require('../receptionistEngine');
const voiceBookingFlow = require('../voice/voiceBookingFlow');
const tools = require('../../tools/receptionistTools');
const notificationServiceReal = require('../notifications/notificationService');

const INTENT_TO_FLOW_ACTION = { book_appointment: 'book', reschedule: 'reschedule', cancel: 'cancel' };

/** Stable per-sender conversation id — one ongoing SMS "conversation" per phone number, the same way one voice call has one CallSid. Never derived from anything other than the provider-reported From number. */
function conversationIdForSms(fromNumber) {
  return `sms:${String(fromNumber || 'unknown').replace(/\D/g, '')}`;
}

/**
 * Handles exactly one inbound text message.
 * @returns {{ reply: string }}
 */
async function handleMessage({ practice, fromNumber, messageText }, deps = {}) {
  const convRepo = deps.conversationRepository || conversationRepository;
  const emergency = deps.emergencyService || emergencyService;
  const engine = deps.receptionistEngine || receptionistEngine;
  const bookingFlow = deps.voiceBookingFlow || voiceBookingFlow;
  const notificationService = deps.notificationService || notificationServiceReal;

  const conversationId = conversationIdForSms(fromNumber);
  const conv = convRepo.getConversation(practice.practiceId, conversationId);
  const text = messageText || '';

  // --- 1. Deterministic emergency check — ALWAYS first, exactly like
  // voice (services/voice/voiceReceptionistEngine.js's own header comment
  // explains why this can never be conditional on flow state). ---
  const keywordUrgency = emergency.classifyUrgency(text);
  if (keywordUrgency === 'life_threatening') {
    if (conv.slots.voicePendingAction) Object.assign(conv.slots, { voicePendingAction: null, voiceStep: null, voiceTargetAppointmentId: null, voiceResolvedDate: null, voiceResolvedTime: null, voiceStepAttempts: 0 });
    try {
      convRepo.appendMessage(practice.practiceId, conversationId, 'user', text);
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', emergency.LIFE_THREATENING_MESSAGE_EN);
      convRepo.updateSlots(practice.practiceId, conversationId, { urgency: 'life_threatening' });
    } catch (err) {
      console.error('smsReceptionistEngine: failed to persist emergency turn (non-fatal):', err.message);
    }
    // Asynchronous, non-blocking clinic alert (spec §16) — never awaited.
    notificationService.notifyEmergencyClinicAlert(practice, { conversationId, channel: 'sms' }).catch(() => {});
    return { reply: emergency.LIFE_THREATENING_MESSAGE_EN };
  }

  // --- 2. A structured flow is already in progress: bypass the AI, exactly
  // like voice — a deterministic answer to a deterministic question. ---
  if (conv.slots.voicePendingAction) {
    const flowResult = await bookingFlow.continueFlow({
      practice, conv, utteranceText: text, callerPhone: fromNumber, conversationId, deps,
    });
    return { reply: flowResult.reply };
  }

  // --- 3. No flow in progress: the SAME shared engine web/voice use. ---
  const result = await engine.understand({ practice, conversationId, message: text, channel: 'sms' }, deps);

  if (result.intent === 'emergency' && result.urgency === 'life_threatening') {
    // Already fully handled (including the clinic alert) inside
    // receptionistEngine.understand() itself — just relay its reply.
    return { reply: result.reply };
  }

  // --- 4. Hand off to the deterministic booking flow — a text message has
  // no clickable booking UI either. ---
  const flowAction = INTENT_TO_FLOW_ACTION[result.intent];
  if (flowAction) {
    const flowResult = await bookingFlow.startFlow({ practice, action: flowAction, conv, callerPhone: fromNumber, conversationId, deps });
    try {
      convRepo.appendMessage(practice.practiceId, conversationId, 'assistant', flowResult.reply);
    } catch (err) {
      console.error('smsReceptionistEngine: failed to persist flow-start turn (non-fatal):', err.message);
    }
    return { reply: flowResult.reply };
  }

  // --- 5. Human handoff: create the real handoff record now (an SMS
  // conversation has no clickable "talk to a human" button either). ---
  if (result.intent === 'human_handoff') {
    const handoffTool = deps.request_human_handoff || tools.request_human_handoff;
    try {
      await handoffTool(practice, { conversationId, reason: 'requested_staff', type: 'send_message', phone: fromNumber, urgency: result.urgency });
    } catch (err) {
      console.error('smsReceptionistEngine: failed to log human handoff request (non-fatal):', err.message);
    }
    return { reply: result.reply };
  }

  // --- 6. Ordinary FAQ/pricing/hours/insurance/general reply. ---
  return { reply: result.reply };
}

module.exports = { handleMessage, conversationIdForSms };
