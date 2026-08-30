const { test } = require('node:test');
const assert = require('node:assert/strict');
const limiter = require('../services/auth/loginRateLimiter');

// Each test uses a unique practiceId/email pair so the module-level Map
// state from one test never bleeds into another.
let counter = 0;
function freshKey() {
  counter += 1;
  return { practiceId: `practice-${counter}`, email: `admin-${counter}@example.com` };
}

test('not locked before any failures', () => {
  const { practiceId, email } = freshKey();
  assert.equal(limiter.isLocked(practiceId, email), false);
});

test('locks out after MAX_ATTEMPTS failures', () => {
  const { practiceId, email } = freshKey();
  for (let i = 0; i < limiter.MAX_ATTEMPTS - 1; i++) {
    limiter.recordFailure(practiceId, email);
    assert.equal(limiter.isLocked(practiceId, email), false, `should not be locked after ${i + 1} failures`);
  }
  limiter.recordFailure(practiceId, email); // Nth failure trips the lock
  assert.equal(limiter.isLocked(practiceId, email), true);
});

test('lockout expires after LOCKOUT_MS', () => {
  const { practiceId, email } = freshKey();
  let fakeNow = 1_000_000;
  const nowFn = () => fakeNow;
  for (let i = 0; i < limiter.MAX_ATTEMPTS; i++) limiter.recordFailure(practiceId, email, nowFn);
  assert.equal(limiter.isLocked(practiceId, email, nowFn), true);

  fakeNow += limiter.LOCKOUT_MS + 1;
  assert.equal(limiter.isLocked(practiceId, email, nowFn), false);
});

test('recordSuccess clears failure history', () => {
  const { practiceId, email } = freshKey();
  for (let i = 0; i < limiter.MAX_ATTEMPTS - 1; i++) limiter.recordFailure(practiceId, email);
  limiter.recordSuccess(practiceId, email);
  // One more failure should behave like a first failure, not trip the lock immediately.
  limiter.recordFailure(practiceId, email);
  assert.equal(limiter.isLocked(practiceId, email), false);
});

test('lockouts are isolated per practiceId even for the same email', () => {
  const email = 'shared@example.com';
  for (let i = 0; i < limiter.MAX_ATTEMPTS; i++) limiter.recordFailure('practice-x', email);
  assert.equal(limiter.isLocked('practice-x', email), true);
  assert.equal(limiter.isLocked('practice-y', email), false);
});

test('lockoutRemainingSeconds counts down and hits 0 once unlocked', () => {
  const { practiceId, email } = freshKey();
  let fakeNow = 0;
  const nowFn = () => fakeNow;
  for (let i = 0; i < limiter.MAX_ATTEMPTS; i++) limiter.recordFailure(practiceId, email, nowFn);
  assert.ok(limiter.lockoutRemainingSeconds(practiceId, email, nowFn) > 0);
  fakeNow += limiter.LOCKOUT_MS + 1;
  assert.equal(limiter.lockoutRemainingSeconds(practiceId, email, nowFn), 0);
});
