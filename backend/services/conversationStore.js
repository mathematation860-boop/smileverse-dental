/**
 * In-memory conversation + slot-memory store, keyed by conversationId.
 *
 * This is what lets the receptionist avoid re-asking things the patient
 * already said in this session ("How much is a cleaning?" -> "Can I book
 * it tomorrow?" should carry `service = Cleaning` forward automatically).
 *
 * This is intentionally simple (a Map, cleared on server restart) — for
 * production this would move to Redis or Mongo, but the interface below
 * (getConversation/updateSlots/appendMessage) would stay the same, so
 * routes and services never touch the Map directly.
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
});

function getConversation(conversationId) {
  if (!conversations.has(conversationId)) {
    conversations.set(conversationId, {
      history: [], // [{ role: 'user'|'assistant', content }]
      slots: EMPTY_SLOTS(),
      createdAt: new Date().toISOString(),
    });
  }
  return conversations.get(conversationId);
}

function appendMessage(conversationId, role, content) {
  const conv = getConversation(conversationId);
  conv.history.push({ role, content });
  // Cap history so memory doesn't grow unbounded in a long-running server.
  if (conv.history.length > 40) {
    conv.history = conv.history.slice(-40);
  }
  return conv;
}

/** Merge new slot values in, but never overwrite a known value with null/undefined. */
function updateSlots(conversationId, partialSlots = {}) {
  const conv = getConversation(conversationId);
  Object.entries(partialSlots).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      conv.slots[key] = value;
    }
  });
  return conv.slots;
}

function resetBookingSlots(conversationId) {
  const conv = getConversation(conversationId);
  conv.slots.serviceId = null;
  conv.slots.datePreference = null;
  conv.slots.patientType = null;
  return conv.slots;
}

module.exports = {
  getConversation,
  appendMessage,
  updateSlots,
  resetBookingSlots,
};
