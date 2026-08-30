/**
 * Phase 4: phone-number-to-practice resolution (config/practiceRepository.js's
 * getPracticeIdForPhoneNumber). This is the ONLY safe way a telephony
 * webhook identifies which practice a call belongs to (see
 * middleware/voicePracticeContext.js) — a caller can never supply their
 * own practiceId the way a web request's X-Practice-Id header could, so
 * this function, and its normalization, has to be exactly right.
 *
 * The practice's voice.phoneNumber is read from an env var at module load
 * time (see config/practices/smileverse-dental.js), so this file sets the
 * env var and forces a fresh require of both the practice config and
 * practiceRepository before each assertion that depends on it — nothing
 * else in the suite relies on that env var, so this is safe in isolation
 * but NOT safe to run in the same process as a test that assumes the
 * default (unset) value; hence a full require-cache reset in
 * afterEach-equivalent cleanup below.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const PRACTICE_CONFIG_PATH = require.resolve('../config/practices/smileverse-dental');
const PRACTICE_REPOSITORY_PATH = require.resolve('../config/practiceRepository');

function freshRepositoryWithPhoneNumber(phoneNumber) {
  delete require.cache[PRACTICE_CONFIG_PATH];
  delete require.cache[PRACTICE_REPOSITORY_PATH];
  if (phoneNumber === undefined) {
    delete process.env.SMILEVERSE_VOICE_PHONE_NUMBER;
  } else {
    process.env.SMILEVERSE_VOICE_PHONE_NUMBER = phoneNumber;
  }
  return require('../config/practiceRepository');
}

test.after(() => {
  // Leave the module cache/env exactly as every other test file expects it.
  freshRepositoryWithPhoneNumber(undefined);
});

test('UNCONFIGURED: with no SMILEVERSE_VOICE_PHONE_NUMBER set, no number resolves to any practice', () => {
  const repo = freshRepositoryWithPhoneNumber(undefined);
  assert.equal(repo.getPracticeIdForPhoneNumber('+15550001111'), null);
});

test('EXACT MATCH: the configured number resolves to the practice', () => {
  const repo = freshRepositoryWithPhoneNumber('+15551234567');
  assert.equal(repo.getPracticeIdForPhoneNumber('+15551234567'), 'smileverse-dental');
});

test('FORMAT-INSENSITIVE MATCH: spaces/dashes/parens and a bare digit string all resolve the same as the canonical +E.164 form', () => {
  const repo = freshRepositoryWithPhoneNumber('+15551234567');
  assert.equal(repo.getPracticeIdForPhoneNumber('+1 (555) 123-4567'), 'smileverse-dental');
  assert.equal(repo.getPracticeIdForPhoneNumber('1-555-123-4567'), 'smileverse-dental');
});

test('NO MATCH: a phone number that is not any configured practice\'s number resolves to null, never a default/guessed practice', () => {
  const repo = freshRepositoryWithPhoneNumber('+15551234567');
  assert.equal(repo.getPracticeIdForPhoneNumber('+19995550000'), null);
});

test('EMPTY/MISSING INPUT: never throws, always returns null', () => {
  const repo = freshRepositoryWithPhoneNumber('+15551234567');
  assert.equal(repo.getPracticeIdForPhoneNumber(''), null);
  assert.equal(repo.getPracticeIdForPhoneNumber(null), null);
  assert.equal(repo.getPracticeIdForPhoneNumber(undefined), null);
});

test('ISOLATION: voice.phoneNumber can never be changed by a practice admin override — always the static base config value', () => {
  const repo = freshRepositoryWithPhoneNumber('+15551234567');
  const { mergePracticeConfig } = require('../services/practice/practiceMerge');
  const base = repo.getPractice('smileverse-dental');
  const merged = mergePracticeConfig(base, { voice: { phoneNumber: '+19995550000' } });
  assert.equal(merged.voice.phoneNumber, '+15551234567', 'an admin-supplied voice.phoneNumber override must never take effect');
});
