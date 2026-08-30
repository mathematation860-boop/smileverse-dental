const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../services/auth/passwordHashing');

test('hashPassword produces a hash that verifyPassword accepts', async () => {
  const hash = await hashPassword('correct-horse-battery-staple');
  assert.notEqual(hash, 'correct-horse-battery-staple');
  assert.equal(await verifyPassword('correct-horse-battery-staple', hash), true);
});

test('verifyPassword rejects a wrong password', async () => {
  const hash = await hashPassword('correct-horse-battery-staple');
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('verifyPassword never throws on garbage input', async () => {
  assert.equal(await verifyPassword('', ''), false);
  assert.equal(await verifyPassword(null, null), false);
  assert.equal(await verifyPassword('x', 'not-a-real-bcrypt-hash'), false);
});

test('hashPassword rejects passwords shorter than 8 characters', async () => {
  await assert.rejects(() => hashPassword('short'));
});

test('two hashes of the same password are different (salted)', async () => {
  const a = await hashPassword('same-password-123');
  const b = await hashPassword('same-password-123');
  assert.notEqual(a, b);
});
