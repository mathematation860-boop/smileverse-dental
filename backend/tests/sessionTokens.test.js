const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_JWT_SECRET = 'test-secret-at-least-16-chars-long';
const sessionTokens = require('../services/auth/sessionTokens');

test('issueToken + verifyToken round-trips adminId/practiceId/role', () => {
  const token = sessionTokens.issueToken({ adminId: 'admin-1', practiceId: 'practice-a', role: 'practice_admin' });
  const decoded = sessionTokens.verifyToken(token);
  assert.deepEqual(decoded, { adminId: 'admin-1', practiceId: 'practice-a', role: 'practice_admin' });
});

test('verifyToken returns null for a tampered token', () => {
  const token = sessionTokens.issueToken({ adminId: 'admin-1', practiceId: 'practice-a', role: 'practice_admin' });
  const tampered = token.slice(0, -2) + 'xx';
  assert.equal(sessionTokens.verifyToken(tampered), null);
});

test('verifyToken returns null for missing/empty input', () => {
  assert.equal(sessionTokens.verifyToken(null), null);
  assert.equal(sessionTokens.verifyToken(''), null);
  assert.equal(sessionTokens.verifyToken('not-a-jwt'), null);
});

test('a token signed with a different secret is rejected', () => {
  const jwt = require('jsonwebtoken');
  const foreignToken = jwt.sign({ adminId: 'x', practiceId: 'y' }, 'a-completely-different-secret-value');
  assert.equal(sessionTokens.verifyToken(foreignToken), null);
});

test('isConfigured reflects whether ADMIN_JWT_SECRET is usable', () => {
  assert.equal(sessionTokens.isConfigured(), true);
});
