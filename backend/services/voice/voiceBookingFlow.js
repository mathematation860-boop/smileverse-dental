/**
 * Deterministic voice booking/cancel/reschedule state machine.
 *
 * Why this exists: the web channel never lets the AI itself execute a
 * booking/cancel/reschedule — a human clicks through a deterministic UI
 * form (BookingFlow) that calls the REST routes, which call
 * tools/receptionistTools.js. A phone caller has no form to click, so
 * something has to deterministically walk the caller through the exact
 * same required fields (service, date, time, name — phone comes from
 * caller ID, never asked) and only THEN call the exact same tools —
 * never a second, duplicated booking pipeline (Phase 4 spec §1, §10).
 *
 * This is intentionally NOT run through the AI turn by turn: once a
 * caller is inside one of these flows, every utterance is interpreted by
 * this file's own small, conservative parsers
 * (./naturalDateTimeParser.js) rather than re-sent to Gemini. That is a
 * deliberate safety choice — a structured, side-effecting flow should
 * behave the same way every time for the same inputs, not be subject to
 * an LLM's turn-by-turn interpretation. The emergency check
 * (services/emergencyService.js) still runs on every utterance regardless
 * of flow state — see services/voice/voiceReceptionistEngine.js, which is
 * the only caller of this module and always checks that FIRST.
 *
 * Every exported function is pure I/O-injected (a `deps` object), the
 * same pattern as services/auth/loginService.js, so the whole state
 * machine is unit-testable without a real database or AI call — see
 * tests/voiceBookingFlow.test.js.
 */

const tools = require('../../tools/receptionistTools');
const availabilityService = require('../availabilityService');
const naturalDateTimeParser = require('./naturalDateTimeParser');

const MAX_STEP_ATTEMPTS = 2; // after this many unparseable answers at the same step, hand off to a human rather than looping forever

const YES_PATTERN = /\b(yes|yeah|yep|yup|sure|correct|confirm|confirmed|that'?s right|please do|book it|go ahead)\b/i;
const NO_PATTERN = /\b(no|nope|not right|incorrect|that'?s wrong|don'?t|do not)\b/i;
// Roman Urdu / Urdu-script affirmatives and negatives, per Phase 4 spec §16.
const YES_PATTERN_UR = /(haan|han|jee|ji|thek hai|theek hai|bilkul|ہاں|جی|ٹھیک ہے)/i;
const NO_PATTERN_UR = /(nahi|nai|mat karo|نہیں)/i;

const HANDOFF_REQUEST_PATTERN = /\b(human|person|representative|agent|operator|front desk|real person)\b/i;
const HANDOFF_REQUEST_PATTERN_UR = /(insaan se|banda|kisi se baat|آدمی سے|انسان سے)/i;

const ABORT_PATTERN = /\b(never mind|nevermind|forget it|cancel that|stop|nothing else)\b/i;

function isAffirmative(text) {
  const t = (text || '').toLowerCase();
  return YES_PATTERN.test(t) || YES_PATTERN_UR.test(text || '');
}
function isNegative(text) {
  const t = (text || '').toLowerCase();
  return NO_PATTERN.test(t) || NO_PATTERN_UR.test(text || '');
}
function wantsHuman(text) {
  const t = (text || '').toLowerCase();
  return HANDOFF_REQUEST_PATTERN.test(t) || HANDOFF_REQUEST_PATTERN_UR.test(text || '');
}
function wantsAbort(text) {
  return ABORT_PATTERN.test((text || '').toLowerCase());
}

/** Finds a practice service whose name/id is mentioned in free text. Conservative substring match only — never guesses between two equally-plausible services. */
function matchService(text, services) {
  const t = (text || '').toLowerCase();
  const matches = services.filter((s) => t.includes(s.name.toLowerCase()) || t.includes(s.id.toLowerCase()));
  return matches.length === 1 ? matches[0] : null;
}

function emptySlotState() {
  return {
    voicePendingAction: null,
    voiceStep: null,
    voiceTargetAppointmentId: null,
    voiceResolvedDate: null,
    voiceResolvedTime: null,
    voiceStepAttempts: 0,
  };
}

/** Clears all flow state (a completed, aborted, or handed-off flow) while leaving ordinary slots like serviceId/name untouched — those stay useful for the rest of the call. */
function clearFlowState(slots) {
  Object.assign(slots, emptySlotState());
}

async function buildHandoffResult({ practice, conversationId, callerPhone, reason, conv, deps }) {
  const handoffTool = deps.request_human_handoff || tools.request_human_handoff;
  try {
    await handoffTool(practice, {
      conversationId,
      reason,
      type: 'call_office',
      phone: callerPhone,
      urgency: 'normal',
    });
  } catch (err) {
    console.error('voiceBookingFlow: failed to log human handoff request (non-fatal):', err.message);
  }
  clearFlowState(conv.slots);
  return {
    reply: "Absolutely, I'll connect you with our front desk team now.",
    transfer: true,
  };
}

/**
 * Starts a new flow (called by voiceReceptionistEngine when the shared AI
 * understand() call returns intent book_appointment/cancel/reschedule and
 * no flow is already in progress). `conv.slots` is mutated in place and
 * also returned via the result for convenience.
 */
async function startFlow({ practice, action, conv, callerPhone, conversationId, deps = {} }) {
  clearFlowState(conv.slots);
  conv.slots.voicePendingAction = action;
  conv.slots.phone = conv.slots.phone || callerPhone || null;

  if (action === 'book') {
    conv.slots.voiceStep = conv.slots.serviceId ? 'collect_date' : 'collect_service';
    if (conv.slots.voiceStep === 'collect_date') {
      return { reply: 'Great — what day would you like to come in?' };
    }
    return { reply: 'Sure, I can help with that. Which service would you like to book?' };
  }

  if (action === 'cancel' || action === 'reschedule') {
    return locateAppointment({ practice, action, conv, callerPhone, conversationId, deps });
  }

  clearFlowState(conv.slots);
  return { reply: "I'm here to help — could you tell me a bit more about what you need?" };
}

async function locateAppointment({ practice, action, conv, callerPhone, conversationId, deps }) {
  const searchTool = deps.search_appointments || tools.search_appointments;
  let matches = [];
  try {
    matches = (await searchTool(practice, callerPhone)) || [];
  } catch (err) {
    console.error('voiceBookingFlow: search_appointments failed:', err.message);
    return buildHandoffResult({ practice, conversationId, callerPhone, reason: 'system_failure', conv, deps });
  }
  // Only upcoming, still-active appointments are a valid cancel/reschedule target.
  const active = matches.filter((a) => a.status !== 'Cancelled');

  if (active.length === 0) {
    clearFlowState(conv.slots);
    return {
      reply:
        "I don't see any upcoming appointments under this phone number. " +
        "I can connect you with our front desk team to look into it, or you're welcome to book a new appointment.",
    };
  }

  if (active.length === 1) {
    conv.slots.voicePendingAction = action;
    conv.slots.voiceTargetAppointmentId = String(active[0]._id);
    if (action === 'cancel') {
      conv.slots.voiceStep = 'confirm';
      return {
        reply: `I found your ${active[0].service} appointment on ${active[0].date} at ${active[0].time}. Should I cancel it?`,
      };
    }
    conv.slots.voiceStep = 'collect_date';
    return {
      reply: `I found your ${active[0].service} appointment on ${active[0].date} at ${active[0].time}. What day would you like to move it to?`,
    };
  }

  // Multiple upcoming appointments: never guess which one — ask the caller
  // to narrow it down by date rather than silently acting on the wrong one.
  conv.slots.voicePendingAction = action;
  conv.slots.voiceStep = 'disambiguate';
  conv.__candidateAppointments = active; // in-process only; re-fetched by continueFlow via search again, see disambiguate step
  const list = active.map((a) => `${a.service} on ${a.date} at ${a.time}`).join('; ');
  return { reply: `I found a few upcoming appointments: ${list}. Which date is the one you mean?` };
}

async function handleDisambiguate({ practice, conv, utteranceText, callerPhone, conversationId, deps }) {
  const searchTool = deps.search_appointments || tools.search_appointments;
  let matches = [];
  try {
    matches = ((await searchTool(practice, callerPhone)) || []).filter((a) => a.status !== 'Cancelled');
  } catch (err) {
    return buildHandoffResult({ practice, conversationId, callerPhone, reason: 'system_failure', conv, deps });
  }
  const date = naturalDateTimeParser.parseDate(utteranceText, practice.timezone);
  const found = date ? matches.filter((a) => a.date === date) : [];

  if (found.length !== 1) {
    conv.slots.voiceStepAttempts += 1;
    if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
      return buildHandoffResult({ practice, conversationId, callerPhone, reason: 'uncertain', conv, deps });
    }
    return { reply: "Sorry, could you tell me the date of the appointment you mean, for example 'Friday' or 'tomorrow'?" };
  }

  conv.slots.voiceStepAttempts = 0;
  conv.slots.voiceTargetAppointmentId = String(found[0]._id);
  if (conv.slots.voicePendingAction === 'cancel') {
    conv.slots.voiceStep = 'confirm';
    return { reply: `Got it — your ${found[0].service} appointment on ${found[0].date} at ${found[0].time}. Should I cancel it?` };
  }
  conv.slots.voiceStep = 'collect_date';
  return { reply: `Got it. What day would you like to move your ${found[0].service} appointment to?` };
}

async function handleCollectService({ practice, conv, utteranceText }) {
  const service = matchService(utteranceText, practice.services);
  if (!service) {
    conv.slots.voiceStepAttempts += 1;
    if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
      return { escalate: true };
    }
    const names = practice.services.slice(0, 4).map((s) => s.name).join(', ');
    return { reply: `Sorry, which service would that be — for example ${names}?` };
  }
  conv.slots.voiceStepAttempts = 0;
  conv.slots.serviceId = service.id;
  conv.slots.voiceStep = 'collect_date';
  return { reply: `Got it, ${service.name}. What day would you like to come in?` };
}

async function handleCollectDate({ practice, conv, utteranceText, deps }) {
  const date = naturalDateTimeParser.parseDate(utteranceText, practice.timezone);
  if (!date || !availabilityService.isOpenDay(practice, date)) {
    conv.slots.voiceStepAttempts += 1;
    if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
      return { escalate: true };
    }
    return { reply: "Sorry, we're not open that day — could you give me another day, like 'tomorrow' or a weekday?" };
  }
  conv.slots.voiceStepAttempts = 0;
  conv.slots.voiceResolvedDate = date;
  conv.slots.voiceStep = 'collect_time';

  const checkAvailability = deps.check_availability || tools.check_availability;
  const availability = await checkAvailability(practice, date);
  const slots = availability?.slots || [];
  if (slots.length === 0) {
    conv.slots.voiceStep = 'collect_date';
    return { reply: `We're fully booked on ${date}. Could you try a different day?` };
  }
  const sample = slots.slice(0, 3).map((s) => s.time).join(', ');
  return { reply: `We have openings on ${date}, for example ${sample}. What time works for you?` };
}

async function handleCollectTime({ practice, conv, utteranceText, deps }) {
  const checkAvailability = deps.check_availability || tools.check_availability;
  const availability = await checkAvailability(practice, conv.slots.voiceResolvedDate);
  const slots = availability?.slots || [];

  const resolved = naturalDateTimeParser.resolveRequestedSlot(utteranceText, slots);
  if (resolved.matched) {
    conv.slots.voiceStepAttempts = 0;
    conv.slots.voiceResolvedTime = resolved.matched.time;
    if (conv.slots.voicePendingAction === 'reschedule' || conv.slots.name) {
      conv.slots.voiceStep = 'confirm';
      return { reply: buildConfirmationPrompt(practice, conv) };
    }
    conv.slots.voiceStep = 'collect_name';
    return { reply: `Got it, ${resolved.matched.time}. Can I get your name for the appointment?` };
  }

  conv.slots.voiceStepAttempts += 1;
  if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
    return { escalate: true };
  }
  if (resolved.candidates.length > 0) {
    const list = resolved.candidates.map((s) => s.time).join(', ');
    return { reply: `That time isn't available. We do have ${list} open — would one of those work?` };
  }
  return { reply: "Sorry, nothing is open around then. Could you tell me another time, like 'morning' or a specific time?" };
}

function isPlausibleName(text) {
  const t = (text || '').trim();
  return t.length >= 2 && t.length <= 200 && !/\d{4,}/.test(t); // reject obvious non-names like a long number string
}

async function handleCollectName({ practice, conv, utteranceText }) {
  if (!isPlausibleName(utteranceText)) {
    conv.slots.voiceStepAttempts += 1;
    if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
      return { escalate: true };
    }
    return { reply: "Sorry, I didn't catch a name — could you say your full name for the appointment?" };
  }
  conv.slots.voiceStepAttempts = 0;
  conv.slots.name = utteranceText.trim();
  conv.slots.voiceStep = 'confirm';
  return { reply: buildConfirmationPrompt(practice, conv) };
}

function buildConfirmationPrompt(practice, conv) {
  const service = practice.services.find((s) => s.id === conv.slots.serviceId);
  const serviceName = service ? service.name : 'appointment';
  if (conv.slots.voicePendingAction === 'reschedule') {
    return `To confirm, I'll move your appointment to ${conv.slots.voiceResolvedDate} at ${conv.slots.voiceResolvedTime}. Is that correct?`;
  }
  return `To confirm: a ${serviceName} appointment on ${conv.slots.voiceResolvedDate} at ${conv.slots.voiceResolvedTime} for ${conv.slots.name}. Shall I book it?`;
}

async function handleConfirm({ practice, conv, utteranceText, callerPhone, conversationId, deps }) {
  if (isNegative(utteranceText)) {
    clearFlowState(conv.slots);
    return { reply: 'No problem, I won\'t make that change. Is there anything else I can help with?' };
  }
  if (!isAffirmative(utteranceText)) {
    conv.slots.voiceStepAttempts += 1;
    if (conv.slots.voiceStepAttempts > MAX_STEP_ATTEMPTS) {
      return { escalate: true };
    }
    return { reply: 'Sorry, should I go ahead — yes or no?' };
  }

  const action = conv.slots.voicePendingAction;
  try {
    if (action === 'book') {
      const createTool = deps.create_appointment || tools.create_appointment;
      const appointment = await createTool(practice, {
        name: conv.slots.name,
        phone: conv.slots.phone || callerPhone,
        service: (practice.services.find((s) => s.id === conv.slots.serviceId) || {}).name || 'Appointment',
        serviceId: conv.slots.serviceId,
        patientType: conv.slots.patientType === 'existing' ? 'existing' : 'new',
        date: conv.slots.voiceResolvedDate,
        time: conv.slots.voiceResolvedTime,
        conversationId,
      });
      clearFlowState(conv.slots);
      if (!appointment) throw new Error('appointment provider returned no confirmation');
      return { reply: `You're all set — your appointment is confirmed for ${conv.slots.voiceResolvedDate || appointment.date} at ${appointment.time}. We look forward to seeing you.` };
    }

    if (action === 'cancel') {
      const cancelTool = deps.cancel_appointment || tools.cancel_appointment;
      const appointment = await cancelTool(practice, conv.slots.voiceTargetAppointmentId, { conversationId });
      clearFlowState(conv.slots);
      if (!appointment) throw new Error('appointment provider did not confirm cancellation');
      return { reply: 'Your appointment has been cancelled. Is there anything else I can help with?' };
    }

    if (action === 'reschedule') {
      const rescheduleTool = deps.reschedule_appointment || tools.reschedule_appointment;
      const appointment = await rescheduleTool(practice, conv.slots.voiceTargetAppointmentId, {
        date: conv.slots.voiceResolvedDate,
        time: conv.slots.voiceResolvedTime,
        conversationId,
      });
      clearFlowState(conv.slots);
      if (!appointment) throw new Error('appointment provider did not confirm reschedule');
      return { reply: `Done — your appointment is now on ${appointment.date} at ${appointment.time}.` };
    }
  } catch (err) {
    console.error(`voiceBookingFlow: ${action} failed —`, err.message);
    clearFlowState(conv.slots);
    return {
      reply:
        "I'm sorry, I'm having trouble completing that appointment right now. " +
        "I can connect you with our front desk team to finish this up.",
      transfer: true,
    };
  }

  clearFlowState(conv.slots);
  return { reply: "Sorry, something went wrong on my end. Let me connect you with our front desk team.", transfer: true };
}

/** Continues an in-progress flow for one caller utterance. Called by voiceReceptionistEngine whenever conv.slots.voicePendingAction is already set. */
async function continueFlow({ practice, conv, utteranceText, callerPhone, conversationId, deps = {} }) {
  if (wantsAbort(utteranceText)) {
    clearFlowState(conv.slots);
    return { reply: 'No problem, I\'ve stopped that. Is there anything else I can help with?' };
  }
  if (wantsHuman(utteranceText)) {
    return buildHandoffResult({ practice, conversationId, callerPhone, reason: 'requested_staff', conv, deps });
  }

  let result;
  switch (conv.slots.voiceStep) {
    case 'collect_service':
      result = await handleCollectService({ practice, conv, utteranceText });
      break;
    case 'collect_date':
      result = await handleCollectDate({ practice, conv, utteranceText, deps });
      break;
    case 'collect_time':
      result = await handleCollectTime({ practice, conv, utteranceText, deps });
      break;
    case 'collect_name':
      result = await handleCollectName({ practice, conv, utteranceText });
      break;
    case 'confirm':
      result = await handleConfirm({ practice, conv, utteranceText, callerPhone, conversationId, deps });
      break;
    case 'disambiguate':
      result = await handleDisambiguate({ practice, conv, utteranceText, callerPhone, conversationId, deps });
      break;
    default:
      clearFlowState(conv.slots);
      result = { reply: "Sorry, let's start over — how can I help you today?" };
  }

  if (result.escalate) {
    return buildHandoffResult({ practice, conversationId, callerPhone, reason: 'uncertain', conv, deps });
  }
  return result;
}

module.exports = { startFlow, continueFlow, isAffirmative, isNegative, wantsHuman, wantsAbort, matchService };
