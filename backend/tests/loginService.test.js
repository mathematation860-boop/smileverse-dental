const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attemptLogin } = require('../services/auth/loginService');

const REAL_ADMIN = { _id: 'admin-1', practiceId: 'practice-a', email: 'alice@a.com', role: 'practice_admin', active: true, passwordHash: 'hashed:correct-password' };
const DISABLED_ADMIN = { _id: 'admin-2', practiceId: 'practice-a', email: 'dana@a.com', role: 'practice_admin', active: false, passwordHash: 'hashed:whatever' };

function fakeDeps(overrides = {}) {
  const rateLimiterState = { locked: false, failures: [], successes: [] };
  return {
    findByEmailForLogin: async (practiceId, email) => {
      if (email === REAL_ADMIN.email && practiceId === REAL_ADMIN.practiceId) return REAL_ADMIN;
      if (email === DISABLED_ADMIN.email && practiceId === DISABLED_ADMIN.practiceId) return DISABLED_ADMIN;
      return null;
    },
    verifyPassword: async (plain, hash) => hash === `hashed:${plain}`,
    issueToken: (claims) => `token-for-${claims.adminId}`,
    markLoginSuccessful: async () => {},
    rateLimiter: {
      isLocked: () => rateLimiterState.locked,
      lockoutRemainingSeconds: () => 600,
      recordFailure: (p, e) => rateLimiterState.failures.push([p, e]),
      recordSuccess: (p, e) => rateLimiterState.successes.push([p, e]),
    },
    ...overrides,
    _rateLimiterState: rateLimiterState,
  };
}

test('successful login: correct email + password returns a safe admin profile and a token', async () => {
  const deps = fakeDeps();
  const result = await attemptLogin({ practiceId: 'practice-a', email: 'alice@a.com', password: 'correct-password' }, deps);
  assert.equal(result.outcome, 'success');
  assert.equal(result.admin.email, 'alice@a.com');
  assert.equal(result.admin.practiceId, 'practice-a');
  assert.equal(result.token, 'token-for-admin-1');
  assert.equal(result.admin.passwordHash, undefined, 'passwordHash must never appear on the returned admin object');
});

test('invalid login: unknown email is rejected generically', async () => {
  const deps = fakeDeps();
  const result = await attemptLogin({ practiceId: 'practice-a', email: 'nobody@a.com', password: 'anything' }, deps);
  assert.equal(result.outcome, 'invalid_credentials');
  assert.equal(deps._rateLimiterState.failures.length, 1);
});

test('invalid login: correct email but wrong password is rejected generically (same outcome as unknown email)', async () => {
  const deps = fakeDeps();
  const result = await attemptLogin({ practiceId: 'practice-a', email: 'alice@a.com', password: 'wrong-password' }, deps);
  assert.equal(result.outcome, 'invalid_credentials');
  assert.equal(deps._rateLimiterState.failures.length, 1);
});

test('disabled account: correct credentials but active:false is rejected as disabled, not invalid_credentials', async () => {
  const deps = fakeDeps();
  const result = await attemptLogin({ practiceId: 'practice-a', email: 'dana@a.com', password: 'whatever' }, deps);
  assert.equal(result.outcome, 'disabled');
});

test('a locked-out practiceId+email pair is rejected before ever checking the password', async () => {
  const deps = fakeDeps();
  deps._rateLimiterState.locked = true;
  let lookedUp = false;
  deps.findByEmailForLogin = async () => {
    lookedUp = true;
    return REAL_ADMIN;
  };
  const result = await attemptLogin({ practiceId: 'practice-a', email: 'alice@a.com', password: 'correct-password' }, deps);
  assert.equal(result.outcome, 'locked');
  assert.equal(lookedUp, false, 'a locked-out login must not even query the database');
});

test('a successful login clears the rate limiter and marks lastLoginAt', async () => {
  const deps = fakeDeps();
  let markedId = null;
  deps.markLoginSuccessful = async (id) => (markedId = id);
  await attemptLogin({ practiceId: 'practice-a', email: 'alice@a.com', password: 'correct-password' }, deps);
  assert.equal(deps._rateLimiterState.successes.length, 1);
  assert.equal(markedId, 'admin-1');
});

test('PRACTICE ISOLATION: the same email under a different practiceId does not match', async () => {
  const deps = fakeDeps();
  const result = await attemptLogin({ practiceId: 'practice-b', email: 'alice@a.com', password: 'correct-password' }, deps);
  assert.equal(result.outcome, 'invalid_credentials');
});
