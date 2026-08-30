/**
 * Conversation memory/context — the store that lets a patient say
 * "I need an appointment tomorrow" then later "Actually move it to
 * Friday" without repeating themselves. Pure in-memory logic, no DB/AI
 * dependency, so it's fully unit-testable.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../services/conversationStore');

function uniqueId(label) {
  return `${label}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

test('conversation context: a fresh conversation starts with empty slots and no history', () => {
  const convId = uniqueId('fresh');
  const conv = store.getConversation('practice-a', convId);
  assert.deepEqual(conv.history, []);
  assert.equal(conv.slots.serviceId, null);
  assert.equal(conv.slots.language, 'en');
});

test('conversation context: appendMessage accumulates turns in order', () => {
  const convId = uniqueId('append');
  store.appendMessage('practice-a', convId, 'user', 'I need an appointment tomorrow.');
  store.appendMessage('practice-a', convId, 'assistant', 'Sure — what service is this for?');
  const conv = store.getConversation('practice-a', convId);
  assert.equal(conv.history.length, 2);
  assert.equal(conv.history[0].role, 'user');
  assert.equal(conv.history[1].content, 'Sure — what service is this for?');
});

test('conversation context: updateSlots merges new facts without erasing what is already known', () => {
  const convId = uniqueId('slots');
  store.updateSlots('practice-a', convId, { serviceId: 'cleaning', datePreference: 'tomorrow' });
  // Patient then says "actually tomorrow doesn't work, move it to Friday" —
  // only datePreference changes, serviceId must be carried forward.
  store.updateSlots('practice-a', convId, { datePreference: 'Friday' });
  const conv = store.getConversation('practice-a', convId);
  assert.equal(conv.slots.serviceId, 'cleaning');
  assert.equal(conv.slots.datePreference, 'Friday');
});

test('conversation context: a null/undefined/empty value never overwrites an already-known slot', () => {
  const convId = uniqueId('no-overwrite');
  store.updateSlots('practice-a', convId, { name: 'Ali' });
  store.updateSlots('practice-a', convId, { name: null, phone: undefined, email: '' });
  const conv = store.getConversation('practice-a', convId);
  assert.equal(conv.slots.name, 'Ali');
  assert.equal(conv.slots.phone, null);
});

test('conversation context: history is capped so a long-running server does not leak memory', () => {
  const convId = uniqueId('cap');
  for (let i = 0; i < 50; i++) {
    store.appendMessage('practice-a', convId, i % 2 === 0 ? 'user' : 'assistant', `message ${i}`);
  }
  const conv = store.getConversation('practice-a', convId);
  assert.ok(conv.history.length <= 40);
  // The most recent message must survive the cap.
  assert.equal(conv.history[conv.history.length - 1].content, 'message 49');
});

test('conversation isolation: the same conversationId under a different practiceId is a completely separate conversation', () => {
  const convId = uniqueId('shared-id');
  store.updateSlots('practice-a', convId, { serviceId: 'cleaning' });
  store.updateSlots('practice-b', convId, { serviceId: 'whitening' });
  assert.equal(store.getConversation('practice-a', convId).slots.serviceId, 'cleaning');
  assert.equal(store.getConversation('practice-b', convId).slots.serviceId, 'whitening');
});
