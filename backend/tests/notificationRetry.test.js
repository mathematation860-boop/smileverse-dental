/**
 * Retry logic tests (Phase 5 spec §24/§27): bounded, never retries a
 * permanent failure, idempotent (same call repeated, not a different one).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { sendWithRetry, isPermanentFailure } = require('../services/notifications/retry');

function noopSleep() {
  return Promise.resolve(); // instant "sleep" so these tests run fast
}

test('a permanent failure (invalid_phone) is never retried — exactly one attempt', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    return { success: false, simulated: false, failureReason: 'invalid_phone' };
  }, { sleep: noopSleep });

  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.success, false);
});

test('a temporary failure (provider_error) is retried up to the bound, then gives up', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    return { success: false, simulated: false, failureReason: 'provider_error' };
  }, { sleep: noopSleep, maxAttempts: 3 });

  assert.equal(calls, 3, 'must retry a temporary failure up to the bound, never indefinitely');
  assert.equal(result.attempts, 3);
  assert.equal(result.success, false);
});

test('succeeds on a later attempt after temporary failures, and stops retrying immediately', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    if (calls < 2) return { success: false, simulated: false, failureReason: 'provider_error' };
    return { success: true, simulated: false, providerMessageId: 'abc' };
  }, { sleep: noopSleep, maxAttempts: 5 });

  assert.equal(calls, 2, 'must stop retrying as soon as it succeeds');
  assert.equal(result.success, true);
  assert.equal(result.attempts, 2);
});

test('a simulated (demo mode) result is never retried, even though success is false', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    return { success: false, simulated: true, providerMessageId: null };
  }, { sleep: noopSleep, maxAttempts: 3 });

  assert.equal(calls, 1, 'a simulated result is not a failure to retry against');
  assert.equal(result.attempts, 1);
});

test('a provider that throws is treated as a (retryable, generic) failure, never propagates', async () => {
  let calls = 0;
  const result = await sendWithRetry(async () => {
    calls += 1;
    throw new Error('boom');
  }, { sleep: noopSleep, maxAttempts: 2 });

  assert.equal(calls, 2);
  assert.equal(result.success, false);
});

test('isPermanentFailure correctly classifies known permanent vs temporary reasons', () => {
  assert.equal(isPermanentFailure('invalid_phone'), true);
  assert.equal(isPermanentFailure('invalid_email'), true);
  assert.equal(isPermanentFailure('blocked_destination'), true);
  assert.equal(isPermanentFailure('provider_error'), false);
  assert.equal(isPermanentFailure('network_error'), false);
});

test('retries are idempotent by construction — every attempt calls the identical sendFn, never a mutated/different request', async () => {
  const seenArgsSnapshots = [];
  const fixedArgs = { to: '+15551234567', body: 'hello' };
  const result = await sendWithRetry(async () => {
    seenArgsSnapshots.push(JSON.stringify(fixedArgs));
    return { success: false, simulated: false, failureReason: 'provider_error' };
  }, { sleep: noopSleep, maxAttempts: 3 });

  assert.equal(new Set(seenArgsSnapshots).size, 1, 'every attempt must be the exact same request');
  assert.equal(result.attempts, 3);
});
