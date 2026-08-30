/**
 * Provider-level tests (Phase 5 spec §2/§3/§4/§27): the mock providers
 * must always report a simulated result, never a fabricated success/id;
 * the real providers must never claim success unless configured (and,
 * when configured, only ever report what the vendor SDK/API itself
 * returned).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const MockEmailProvider = require('../services/notifications/MockEmailProvider');
const MockSMSProvider = require('../services/notifications/MockSMSProvider');
const TwilioSMSProvider = require('../services/notifications/TwilioSMSProvider');
const SendGridEmailProvider = require('../services/notifications/SendGridEmailProvider');

test('MockEmailProvider: never reports success, always simulated, never a fabricated message id', async () => {
  const provider = new MockEmailProvider();
  const result = await provider.send({ to: 'patient@example.com', subject: 'Hi', text: 'hello' });
  assert.equal(result.success, false);
  assert.equal(result.simulated, true);
  assert.equal(result.providerMessageId, null);
  assert.match(result.message, /simulated successfully/i);
});

test('MockSMSProvider: never reports success, always simulated, never a fabricated message id', async () => {
  const provider = new MockSMSProvider();
  const result = await provider.send({ to: '+15551234567', body: 'hello' });
  assert.equal(result.success, false);
  assert.equal(result.simulated, true);
  assert.equal(result.providerMessageId, null);
});

test('MockSMSProvider: never reports a webhook as verified (it has no real webhooks)', () => {
  const provider = new MockSMSProvider();
  const result = provider.verifyWebhookSignature({ signatureHeader: 'anything', fullUrl: 'https://x', params: {} });
  assert.equal(result.valid, false);
});

test('TwilioSMSProvider: isConfigured() is false without real credentials, and send() honestly fails rather than pretending', async () => {
  const provider = new TwilioSMSProvider({ accountSid: undefined, authToken: undefined, fromNumber: undefined });
  assert.equal(provider.isConfigured(), false);
  const result = await provider.send({ to: '+15551234567', body: 'hi' });
  assert.equal(result.success, false);
  assert.equal(result.simulated, false);
  assert.equal(result.failureReason, 'twilio_not_configured');
});

test('TwilioSMSProvider: webhook signature check fails honestly when not configured, never claims verified', () => {
  const provider = new TwilioSMSProvider({ accountSid: undefined, authToken: undefined });
  const result = provider.verifyWebhookSignature({ signatureHeader: 'x', fullUrl: 'https://x', params: {} });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'twilio-not-configured');
});

test('SendGridEmailProvider: isConfigured() is false without real credentials, and send() honestly fails rather than pretending', async () => {
  const provider = new SendGridEmailProvider({ apiKey: undefined, fromEmail: undefined });
  assert.equal(provider.isConfigured(), false);
  const result = await provider.send({ to: 'patient@example.com', subject: 'Hi', text: 'hello' });
  assert.equal(result.success, false);
  assert.equal(result.simulated, false);
  assert.equal(result.failureReason, 'sendgrid_not_configured');
});

test('SendGridEmailProvider: reports success ONLY when the (faked) HTTP call itself returns 202, using SendGrid\'s own message id', async () => {
  const provider = new SendGridEmailProvider({ apiKey: 'test-key', fromEmail: 'clinic@example.com' });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ status: 202, headers: { get: (h) => (h === 'x-message-id' ? 'sg-real-id-123' : null) } });
  try {
    const result = await provider.send({ to: 'patient@example.com', subject: 'Hi', text: 'hello' });
    assert.equal(result.success, true);
    assert.equal(result.providerMessageId, 'sg-real-id-123');
  } finally {
    global.fetch = originalFetch;
  }
});

test('SendGridEmailProvider: a non-202 response is reported as a real failure, never coerced into success', async () => {
  const provider = new SendGridEmailProvider({ apiKey: 'test-key', fromEmail: 'clinic@example.com' });
  const originalFetch = global.fetch;
  global.fetch = async () => ({ status: 400, headers: { get: () => null }, json: async () => ({ errors: [{ message: 'The from address does not match a verified Sender Identity' }] }) });
  try {
    const result = await provider.send({ to: 'patient@example.com', subject: 'Hi', text: 'hello' });
    assert.equal(result.success, false);
    assert.ok(result.failureReason);
  } finally {
    global.fetch = originalFetch;
  }
});
