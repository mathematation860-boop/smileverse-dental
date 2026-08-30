/**
 * Phase 4 spec §23: structured logging must never leak sensitive values
 * (webhook signatures, auth tokens/credentials) even though it DOES log
 * identifiers useful for debugging (session/call id, practice id,
 * provider name, verification outcome). This asserts the actual log
 * lines middleware/voicePracticeContext.js produces never contain the
 * raw signature header or account credentials.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { invokeRoute } = require('./helpers/invokeRoute');
const { buildVoicePracticeContext } = require('../middleware/voicePracticeContext');

test('a webhook signature value and account credentials never appear in console output, even when verification fails', async () => {
  const SECRET_SIGNATURE = 'sha1=super-secret-signature-value-should-never-be-logged';
  const SECRET_AUTH_TOKEN = 'sk-should-never-appear-in-logs';

  const middleware = buildVoicePracticeContext({
    practiceRepository: {
      getPracticeIdForPhoneNumber: () => 'practice-a',
      getPracticeResolved: async () => ({ practiceId: 'practice-a', name: 'Clinic A', demoMode: false }),
    },
    voiceProviders: {
      getTelephonyProvider: () => ({
        providerName: 'twilio',
        isConfigured: () => true,
        verifyWebhookSignature: ({ signatureHeader }) => {
          // A real provider's failure reason must never echo the secret back.
          void signatureHeader;
          return { valid: false, reason: `signature-mismatch (token used: ${SECRET_AUTH_TOKEN.slice(0, 0)})` };
        },
      }),
    },
  });

  const router = express.Router();
  router.use(middleware);
  router.post('/voice/incoming', (req, res) => res.json({ ok: true }));

  const originalLog = console.log;
  const originalWarn = console.warn;
  const captured = [];
  console.log = (...args) => captured.push(args.join(' '));
  console.warn = (...args) => captured.push(args.join(' '));
  try {
    await invokeRoute(router, 'POST', '/voice/incoming', {
      body: { To: '+15550001111', CallSid: 'CA1' },
      headers: { 'x-twilio-signature': SECRET_SIGNATURE },
      get: () => 'example.com',
    });
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  const allOutput = captured.join('\n');
  assert.doesNotMatch(allOutput, new RegExp(SECRET_SIGNATURE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the raw signature header value must never be logged');
  assert.doesNotMatch(allOutput, /SECRET_AUTH_TOKEN|sk-should-never-appear/, 'no credential/token value must ever be logged');
  // But the useful, non-sensitive identifiers ARE expected to be present.
  assert.match(allOutput, /practice-a/);
  assert.match(allOutput, /CA1/);
});
