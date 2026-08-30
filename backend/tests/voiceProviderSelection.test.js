/**
 * services/voice/index.js is the ONE place that decides whether a
 * practice's calls are served by the mock telephony provider or a real
 * Twilio account — the exact same two-key safety gate Phase 2 established
 * for the appointment/calendar provider (see tests/providerSelection.test.js),
 * applied to telephony. Phase 4 spec §2/§24: never let a practice go live
 * on real telephony except by a deliberate, reviewed config-file change.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getTelephonyProvider, getSpeechToTextProvider, getTextToSpeechProvider } = require('../services/voice');
const MockTelephonyProvider = require('../services/voice/MockTelephonyProvider');
const TwilioTelephonyProvider = require('../services/voice/TwilioTelephonyProvider');
const TwilioNativeSpeechProvider = require('../services/voice/TwilioNativeSpeechProvider');
const TelephonyNativeTextToSpeechProvider = require('../services/voice/TelephonyNativeTextToSpeechProvider');

test('demo mode: demoMode true always uses the mock telephony provider, regardless of integrations.voiceProvider', () => {
  const practice = { demoMode: true, integrations: { voiceProvider: 'twilio' } };
  assert.ok(getTelephonyProvider(practice) instanceof MockTelephonyProvider);
});

test('demo mode: demoMode missing/undefined defaults to the safe mock provider (never assume production)', () => {
  const practice = { integrations: { voiceProvider: 'twilio' } };
  assert.ok(getTelephonyProvider(practice) instanceof MockTelephonyProvider);
});

test('production mode: demoMode false + voiceProvider twilio uses the real Twilio provider', () => {
  const practice = { demoMode: false, integrations: { voiceProvider: 'twilio' } };
  assert.ok(getTelephonyProvider(practice) instanceof TwilioTelephonyProvider);
});

test('production mode: demoMode false + voiceProvider mock (or unset) still uses the mock provider', () => {
  assert.ok(getTelephonyProvider({ demoMode: false, integrations: { voiceProvider: 'mock' } }) instanceof MockTelephonyProvider);
  assert.ok(getTelephonyProvider({ demoMode: false, integrations: {} }) instanceof MockTelephonyProvider);
});

test('an unrecognized voiceProvider value falls back to the mock provider rather than throwing or pretending', () => {
  const practice = { demoMode: false, integrations: { voiceProvider: 'some_future_telephony_vendor' } };
  assert.ok(getTelephonyProvider(practice) instanceof MockTelephonyProvider);
});

test('the SmileVerse demo practice config itself resolves to the mock telephony provider today (nothing switched it to production)', () => {
  const smileverse = require('../config/practices/smileverse-dental');
  assert.ok(getTelephonyProvider(smileverse) instanceof MockTelephonyProvider);
});

test('a real TwilioTelephonyProvider with no env credentials honestly reports isConfigured() false, even though it WAS selected', () => {
  const originalSid = process.env.TWILIO_ACCOUNT_SID;
  const originalToken = process.env.TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
  try {
    const provider = new TwilioTelephonyProvider();
    assert.equal(provider.isConfigured(), false);
    const result = provider.verifyWebhookSignature({ signatureHeader: 'x', fullUrl: 'https://example.com', params: {} });
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'twilio-not-configured');
  } finally {
    if (originalSid !== undefined) process.env.TWILIO_ACCOUNT_SID = originalSid;
    if (originalToken !== undefined) process.env.TWILIO_AUTH_TOKEN = originalToken;
  }
});

test('speech-to-text and text-to-speech provider factories always return an implementation, honestly documented as native pass-throughs', () => {
  assert.ok(getSpeechToTextProvider({}) instanceof TwilioNativeSpeechProvider);
  assert.ok(getTextToSpeechProvider({}) instanceof TelephonyNativeTextToSpeechProvider);
});
