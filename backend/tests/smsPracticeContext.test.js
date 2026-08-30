/**
 * middleware/smsPracticeContext.js — the SMS-channel equivalent of
 * middleware/voicePracticeContext.js (see tests/voicePracticeContext.test.js,
 * which this mirrors almost line for line): resolves practice from the
 * texted-to number (never anything caller-suppliable) and rejects forged
 * webhooks BEFORE any business logic runs (Phase 5 spec §11/§20/§21).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const express = require('express');
const { buildSmsPracticeContext } = require('../middleware/smsPracticeContext');

const PRACTICE_A = { practiceId: 'practice-a', name: 'Clinic A', phone: '+15550001111', demoMode: true };

function fakePracticeRepository({ phoneMap = {}, practice = PRACTICE_A } = {}) {
  return {
    getPracticeIdForPhoneNumber: (to) => phoneMap[to] || null,
    getPracticeResolved: async (practiceId) => (practiceId === practice.practiceId ? practice : null),
  };
}

function fakeNotificationProviders(verification = { valid: true, reason: 'unverified-mock-mode' }) {
  return {
    getSmsProvider: () => ({ providerName: 'mock', verifyWebhookSignature: () => verification }),
  };
}

function buildTestRouter(deps) {
  const middleware = buildSmsPracticeContext(deps);
  const router = express.Router();
  router.use(middleware);
  router.post('/sms/incoming', (req, res) => {
    res.json({ reachedHandler: true, practiceId: req.practiceId, providerName: req.smsProvider.providerName });
  });
  return router;
}

test('UNKNOWN NUMBER: a text to a number no practice has configured is rejected with safe TwiML, never reaches the handler', async () => {
  const router = buildTestRouter({ practiceRepository: fakePracticeRepository({ phoneMap: {} }), notificationProviders: fakeNotificationProviders() });
  const { res } = await invokeRoute(router, 'POST', '/sms/incoming', { body: { To: '+19995550000' }, headers: {}, get: () => '' });
  assert.equal(res.body?.reachedHandler, undefined);
});

test('the "To" number is the ONLY thing that resolves the practice — nothing else in the body is trusted', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    notificationProviders: fakeNotificationProviders(),
  });
  const { res } = await invokeRoute(router, 'POST', '/sms/incoming', {
    body: { To: '+15550001111', practiceId: 'someone-elses-practice' },
    headers: {},
    get: () => '',
  });
  assert.equal(res.body.practiceId, 'practice-a');
});

test('FORGED WEBHOOK: an invalid signature is rejected with 403, never reaches the handler', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    notificationProviders: fakeNotificationProviders({ valid: false, reason: 'signature-mismatch' }),
  });
  const { res } = await invokeRoute(router, 'POST', '/sms/incoming', { body: { To: '+15550001111' }, headers: { 'x-twilio-signature': 'bogus' }, get: () => '' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body?.reachedHandler, undefined);
});

test('VALID MESSAGE: a correctly-signed webhook to a configured number reaches the handler with the resolved practice attached', async () => {
  const router = buildTestRouter({
    practiceRepository: fakePracticeRepository({ phoneMap: { '+15550001111': 'practice-a' } }),
    notificationProviders: fakeNotificationProviders({ valid: true, reason: 'verified' }),
  });
  const { res } = await invokeRoute(router, 'POST', '/sms/incoming', { body: { To: '+15550001111' }, headers: { 'x-twilio-signature': 'real-looking' }, get: () => '' });
  assert.equal(res.body.reachedHandler, true);
  assert.equal(res.body.practiceId, 'practice-a');
});
