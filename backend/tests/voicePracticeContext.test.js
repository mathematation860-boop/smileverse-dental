/**
 * middleware/voicePracticeContext.js is the ONE gate every voice webhook
 * passes through: it decides which practice a call belongs to (from the
 * dialed number — never a caller-suppliable value) and whether the
 * webhook's signature is genuine. Both failure modes must reject BEFORE
 * any business logic runs — see Phase 4 spec §5 (never trust
 * caller-supplied practiceId) and §21/§22 (reject forged webhooks).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const express = require('express');
const { buildVoicePracticeContext } = require('../middleware/voicePracticeContext');

const PRACTICE_A = { practiceId: 'practice-a', name: 'Clinic A', phone: '+15550001111', demoMode: true };

function fakePracticeRepository({ phoneMap = {}, practice = PRACTICE_A } = {}) {
  return {
    getPracticeIdForPhoneNumber: (to) => phoneMap[to] || null,
    getPracticeResolved: async (practiceId) => (practiceId === practice.practiceId ? practice : null),
  };
}

function fakeVoiceProviders(verification = { valid: true, reason: 'unverified-mock-mode' }) {
  return {
    getTelephonyProvider: () => ({
      providerName: 'mock',
      verifyWebhookSignature: () => verification,
    }),
  };
}

function buildTestRouter(deps) {
  const middleware = buildVoicePracticeContext(deps);
  const router = express.Router();
  router.use(middleware);
  router.post('/voice/incoming', (req, res) => {
    res.json({ reachedHandler: true, practiceId: req.practiceId, providerName: req.voiceProvider.providerName });
  });
  return router;
}

test('UNKNOWN NUMBER: a call to a number no practice has configured is rejected with safe TwiML, never reaches the handler', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: {} }),
    voiceProviders: fakeVoiceProviders(),
  });
  const { res } = await invokeRoute(router, 'POST', '/voice/incoming', { body: { To: '+19995550000' }, headers: {}, get: () => '' });
  assert.equal(res.body?.reachedHandler, undefined, 'the route handler must never run for an unconfigured number');
});

test('CALLER-SUPPLIED practiceId IS IGNORED: only the dialed ("To") number ever resolves the practice', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    voiceProviders: fakeVoiceProviders(),
  });
  // Even if a malicious/confused caller's body somehow carried a practiceId
  // field, this middleware never reads it — only body.To.
  const { res } = await invokeRoute(router, 'POST', '/voice/incoming', {
    body: { To: '+15550001111', practiceId: 'someone-elses-practice' },
    headers: {},
    get: () => '',
  });
  assert.equal(res.body.practiceId, 'practice-a');
});

test('FORGED WEBHOOK: an invalid signature is rejected with 403, never reaches the handler', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    voiceProviders: fakeVoiceProviders({ valid: false, reason: 'signature-mismatch' }),
  });
  const { res } = await invokeRoute(router, 'POST', '/voice/incoming', {
    body: { To: '+15550001111' },
    headers: { 'x-twilio-signature': 'bogus' },
    get: () => '',
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.reachedHandler, undefined);
});

test('VALID CALL: a correctly-signed webhook to a configured number reaches the handler with the resolved practice attached', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    voiceProviders: fakeVoiceProviders({ valid: true, reason: 'verified' }),
  });
  const { res } = await invokeRoute(router, 'POST', '/voice/incoming', {
    body: { To: '+15550001111' },
    headers: { 'x-twilio-signature': 'real-looking-signature' },
    get: () => '',
  });
  assert.equal(res.body.reachedHandler, true);
  assert.equal(res.body.practiceId, 'practice-a');
});

test('MISSING SIGNATURE: mock mode (no real credentials) still lets the call through, but a real provider with no signature is rejected', async () => {
  const mockRouter = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    voiceProviders: fakeVoiceProviders({ valid: true, reason: 'unverified-mock-mode' }),
  });
  const mockResult = await invokeRoute(mockRouter, 'POST', '/voice/incoming', { body: { To: '+15550001111' }, headers: {}, get: () => '' });
  assert.equal(mockResult.res.body.reachedHandler, true);

  const realRouter = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    voiceProviders: fakeVoiceProviders({ valid: false, reason: 'missing-signature' }),
  });
  const realResult = await invokeRoute(realRouter, 'POST', '/voice/incoming', { body: { To: '+15550001111' }, headers: {}, get: () => '' });
  assert.equal(realResult.res.statusCode, 403);
});
