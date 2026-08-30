/**
 * In-memory conversation + slot-memory store, keyed by practiceId +
 * conversationId.
 *
 * This is what lets the receptionist avoid re-asking things the patient
 * already said in this session ("How much is a cleaning?" -> "Can I book
 * it tomorrow?" should carry `service = Cleaning` forward automatically).
 *
 * This is intentionally simple (a Map, cleared on server restart, scoped
 * per practice so one clinic's conversation state can never leak into
 * another's) — for production this would move to Redis or a database
 * table, but the interface below (getConversation/updateSlots/
 * appendMessage) would stay the same. See
 * repositories/ConversationRepository.js for the public-facing wrapper
 * routes/services actually import.
 */

const conversations = new Map();

const EMPTY_SLOTS = () => ({
  serviceId: null,
  datePreference: null,
  patientType: null, // 'new' | 'existing'
  name: null,
  phone: null,
  email: null,
  language: 'en', // 'en' | 'ur'
  // Phase 4 (voice channel only): deterministic booking/cancel/reschedule
  // state-machine fields — see services/voice/voiceBookingFlow.js. Always
  // null/0 for a web chat conversation, which never sets them.
  voicePendingAction: null, // null | 'book' | 'cancel' | 'reschedule'
  voiceStep: null,
  voiceTargetAppointmentId: null,
  voiceResolvedDate: null,
  voiceResolvedTime: null,
  voiceStepAttempts: 0,
});

function key(practiceId, conversationId) {
  return `${practiceId}::${conversationId}`;
}

function getConversation(practiceId, conversationId) {
  const k = key(practiceId, conversationId);
  if (!conversations.has(k)) {
    conversations.set(k, {
      practiceId,
      conversationId,
      history: [], // [{ role: 'user'|'assistant', content }]
      slots: EMPTY_SLOTS(),
      createdAt: new Date().toISOString(),
    });
  }
  return conversations.get(k);
}

function appendMessage(practiceId, conversationId, role, content) {
  const conv = getConversation(practiceId, conversationId);
  conv.history.push({ role, content });
  // Cap history so memory doesn't grow unbounded in a long-running server.
  if (conv.history.length > 40) {
    conv.history = conv.history.slice(-40);
  }
  return conv;
}

/** Merge new slot values in, but never overwrite a known value with null/undefined. */
function updateSlots(practiceId, conversationId, partialSlots = {}) {
  const conv = getConversation(practiceId, conversationId);
  Object.entries(partialSlots).forEach(([k2, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      conv.slots[k2] = value;
    }
  });
  return conv.slots;
}

/**
 * All conversations for one practice, newest first (Phase 3 admin
 * Conversations list — see repositories/ConversationRepository.js and
 * routes/adminDashboard.js). Additive, read-only — never touches
 * existing behavior. Same caveat as the rest of this store: in-memory,
 * so this only reflects conversations since the process last restarted.
 */
function listConversations(practiceId) {
  const results = [];
  for (const conv of conversations.values()) {
    if (conv.practiceId === practiceId) results.push(conv);
  }
  return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  getConversation,
  appendMessage,
  updateSlots,
  listConversations,
};
