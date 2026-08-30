/**
 * Destination validation/masking tests (Phase 5 spec §10/§18/§27).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const validation = require('../services/notifications/validation');

test('isValidEmail accepts well-formed addresses and rejects garbage', () => {
  assert.equal(validation.isValidEmail('sarah@example.com'), true);
  assert.equal(validation.isValidEmail('not-an-email'), false);
  assert.equal(validation.isValidEmail(''), false);
  assert.equal(validation.isValidEmail(null), false);
  assert.equal(validation.isValidEmail('missing-domain@'), false);
});

test('isValidPhone accepts plausible phone numbers in various formats, rejects garbage', () => {
  assert.equal(validation.isValidPhone('+15551234567'), true);
  assert.equal(validation.isValidPhone('(555) 123-4567'), true);
  assert.equal(validation.isValidPhone('123'), false);
  assert.equal(validation.isValidPhone(''), false);
  assert.equal(validation.isValidPhone(null), false);
});

test('maskEmail never reveals the full local part', () => {
  const masked = validation.maskEmail('sarah@example.com');
  assert.ok(masked.startsWith('sa'));
  assert.doesNotMatch(masked, /sarah@/);
  assert.match(masked, /@example\.com$/);
});

test('maskPhone reveals only the last 4 digits', () => {
  const masked = validation.maskPhone('+15551234567');
  assert.equal(masked, '***4567');
});

test('maskEmail/maskPhone return null for invalid input rather than masking garbage', () => {
  assert.equal(validation.maskEmail('not-an-email'), null);
  assert.equal(validation.maskPhone('12'), null);
});
