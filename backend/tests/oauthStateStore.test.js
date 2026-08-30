/**
 * The OAuth `state` nonce store (routes/calendarAuth.js's CSRF defense —
 * this app has no admin session system to hang the state on instead).
 * Pure, in-memory, no network — just the single-use + practice-binding
 * contract that makes a forged /oauth/callback request unable to attach
 * a Google account to a practiceId it didn't start the flow for.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createState, consumeState } = require('../services/calendar/oauthStateStore');

test('a freshly created state resolves back to the practiceId it was minted for', () => {
  const state = createState('practice-a');
  assert.equal(consumeState(state), 'practice-a');
});

test('a state can only be consumed once', () => {
  const state = createState('practice-a');
  assert.equal(consumeState(state), 'practice-a');
  assert.equal(consumeState(state), null, 'a replayed state must not validate a second time');
});

test('an unrecognized/forged state never resolves to any practice', () => {
  assert.equal(consumeState('not-a-real-nonce'), null);
});

test('two different practices get independent, non-colliding states', () => {
  const stateA = createState('practice-a');
  const stateB = createState('practice-b');
  assert.notEqual(stateA, stateB);
  assert.equal(consumeState(stateB), 'practice-b');
  assert.equal(consumeState(stateA), 'practice-a');
});
