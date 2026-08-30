/**
 * Provider SELECTION honesty (Phase 5 spec §3/§4/§22) — mirrors
 * tests/providerSelection.test.js (Phase 2, calendar) and
 * tests/voiceProviderSelection.test.js (Phase 4, telephony): demoMode is
 * the master switch, and a real provider is only ever selected for a
 * practice explicitly configured for it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { getEmailProvider, getSmsProvider } = require('../services/notifications');

function practiceWith(overrides) {
  return { practiceId: 'p1', demoMode: true, integrations: {}, ...overrides };
}

test('demoMode:true (the default) ALWAYS returns the mock providers, regardless of integrations config', () => {
  const practice = practiceWith({ demoMode: true, integrations: { emailProvider: 'sendgrid', smsProvider: 'twilio' } });
  assert.equal(getEmailProvider(practice).providerName, 'mock');
  assert.equal(getSmsProvider(practice).providerName, 'mock');
});

test('demoMode:false + integrations.emailProvider:"sendgrid" selects the real SendGrid provider', () => {
  const practice = practiceWith({ demoMode: false, integrations: { emailProvider: 'sendgrid' } });
  assert.equal(getEmailProvider(practice).providerName, 'sendgrid');
});

test('demoMode:false + integrations.smsProvider:"twilio" selects the real Twilio provider', () => {
  const practice = practiceWith({ demoMode: false, integrations: { smsProvider: 'twilio' } });
  assert.equal(getSmsProvider(practice).providerName, 'twilio');
});

test('demoMode:false + an unrecognized provider name falls back to mock rather than crashing or guessing', () => {
  const practice = practiceWith({ demoMode: false, integrations: { emailProvider: 'mailchimp', smsProvider: 'plivo' } });
  assert.equal(getEmailProvider(practice).providerName, 'mock');
  assert.equal(getSmsProvider(practice).providerName, 'mock');
});

test('a real provider selected but missing credentials still reports isConfigured() === false (selection alone never means "live")', () => {
  delete process.env.SENDGRID_API_KEY;
  delete process.env.TWILIO_ACCOUNT_SID;
  const practice = practiceWith({ demoMode: false, integrations: { emailProvider: 'sendgrid', smsProvider: 'twilio' } });
  assert.equal(getEmailProvider(practice).isConfigured(), false);
  assert.equal(getSmsProvider(practice).isConfigured(), false);
});
