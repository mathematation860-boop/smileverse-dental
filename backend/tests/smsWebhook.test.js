/**
 * routes/smsWebhook.js — the thin webhook-to-TwiML adapter layer for SMS
 * (Phase 5 spec §11/§21/§27). Mirrors tests/voiceRoutes.test.js's own
 * structure: inject a fake smsPracticeContext (practice resolution/
 * signature verification is covered separately by
 * tests/smsPracticeContext.test.js), a fake smsReceptionistEngine, and a
 * fake NotificationLogRepository.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { buildSmsRouter } = require('../routes/smsWebhook');

const PRACTICE = { practiceId: 'test-practice', name: 'SmileVerse Dental', phone: '+15559998888', demoMode: true };

function fakeSmsPracticeContext(req, res, next) {
  req.practiceId = PRACTICE.practiceId;
  req.practice = PRACTICE;
  req.smsProvider = { providerName: 'mock' };
  next();
}

function fakeReq(body, headers = {}) {
  return { body, headers, get: () => 'example.com', protocol: 'https', originalUrl: '/api/sms/incoming' };
}

test('INCOMING TEXT: replies with Messaging TwiML containing the engine\'s reply', async () => {
  const smsReceptionistEngine = { handleMessage: async ({ messageText }) => ({ reply: `You said: ${messageText}` }) };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, smsReceptionistEngine });

  const { res } = await invokeRoute(router, 'POST', '/incoming', fakeReq({ From: '+15551112222', To: '+15559998888', Body: 'What are your hours?', MessageSid: 'SM1' }));

  assert.match(res.body, /<Message>/);
  assert.match(res.body, /You said: What are your hours\?/);
});

test('EMPTY MESSAGE: an empty/malformed webhook gets an empty (but valid) TwiML reply, never calls the engine', async () => {
  let engineCalled = false;
  const smsReceptionistEngine = { handleMessage: async () => { engineCalled = true; return { reply: 'x' }; } };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, smsReceptionistEngine });

  const { res } = await invokeRoute(router, 'POST', '/incoming', fakeReq({ From: '+15551112222', To: '+15559998888', Body: '' }));

  assert.equal(engineCalled, false);
  assert.match(res.body, /<Response>/);
});

test('ENGINE FAILURE: an unexpected error still produces a safe, honest reply — never a raw 500', async () => {
  const smsReceptionistEngine = { handleMessage: async () => { throw new Error('boom'); } };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, smsReceptionistEngine });

  const { res } = await invokeRoute(router, 'POST', '/incoming', fakeReq({ From: '+15551112222', To: '+15559998888', Body: 'hello' }));

  assert.match(res.body, /<Message>/);
  assert.match(res.body, /trouble right now/);
});

test('STATUS CALLBACK: updates the matching notification record from its provider message id', async () => {
  const updates = [];
  const notificationLogRepository = {
    updateStatusByProviderMessageId: async (practiceId, sid, patch) => { updates.push({ practiceId, sid, patch }); },
  };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, notificationLogRepository });

  const { res } = await invokeRoute(router, 'POST', '/status', fakeReq({ MessageSid: 'SM123', MessageStatus: 'delivered', To: '+15559998888' }));

  assert.equal(res.statusCode, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].sid, 'SM123');
  assert.equal(updates[0].patch.status, 'sent');
});

test('STATUS CALLBACK: a retried/duplicate webhook for the same message applies the same idempotent update, never creates a second effect', async () => {
  const updates = [];
  const notificationLogRepository = {
    updateStatusByProviderMessageId: async (practiceId, sid, patch) => { updates.push({ practiceId, sid, patch }); },
  };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, notificationLogRepository });

  await invokeRoute(router, 'POST', '/status', fakeReq({ MessageSid: 'SM999', MessageStatus: 'delivered', To: '+15559998888' }));
  await invokeRoute(router, 'POST', '/status', fakeReq({ MessageSid: 'SM999', MessageStatus: 'delivered', To: '+15559998888' }));

  assert.equal(updates.length, 2, 'the handler runs both times');
  assert.deepEqual(updates[0].patch, updates[1].patch, 'but the update itself is idempotent — applying it twice sets the exact same final state');
});

test('STATUS CALLBACK: an unrecognized status is not translated into a false "sent"/"failed" claim', async () => {
  const updates = [];
  const notificationLogRepository = { updateStatusByProviderMessageId: async (p, s, patch) => updates.push(patch) };
  const router = buildSmsRouter({ smsPracticeContext: fakeSmsPracticeContext, notificationLogRepository });

  await invokeRoute(router, 'POST', '/status', fakeReq({ MessageSid: 'SM1', MessageStatus: 'queued', To: '+15559998888' }));

  assert.equal(updates.length, 0, 'an in-flight, non-final status must not overwrite the record with a guess');
});
