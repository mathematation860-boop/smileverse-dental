const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B, PRACTICES } = require('./helpers/fakeAuth');
const { buildAdminVoiceRouter } = require('../routes/adminVoice');

function fakeCallLogRepository(seed = {}) {
  const byPractice = new Map(Object.entries(seed));
  return {
    async getSummary(practiceId) {
      const rows = byPractice.get(practiceId) || [];
      return {
        total: rows.length,
        answered: rows.filter((r) => r.turnCount > 0).length,
        transferred: rows.filter((r) => r.handoffRequested).length,
        missed: rows.filter((r) => r.status === 'no_answer').length,
        appointmentConversions: rows.filter((r) => r.appointmentCreated).length,
        avgDurationSeconds: rows.length ? Math.round(rows.reduce((s, r) => s + (r.durationSeconds || 0), 0) / rows.length) : 0,
      };
    },
    async listForPractice(practiceId) {
      return byPractice.get(practiceId) || [];
    },
  };
}

test('EMPTY HISTORY: a practice with no calls yet reports real zeros, never sample/demo numbers', async () => {
  const router = buildAdminVoiceRouter({ requireAuthMiddleware: fakeAuthMiddleware, callLogRepository: fakeCallLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/voice', { testAdmin: ADMIN_A });

  assert.equal(res.body.stats.totalCalls, 0);
  assert.equal(res.body.stats.answeredCalls, 0);
  assert.equal(res.body.stats.appointmentConversions, 0);
  assert.equal(res.body.stats.avgDurationSeconds, 0);
});

test('DEMO MODE NEVER REPORTS "enabled": even with calls logged, a demoMode practice is never claimed as live voice', async () => {
  const router = buildAdminVoiceRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    callLogRepository: fakeCallLogRepository({ 'practice-a': [{ turnCount: 3, appointmentCreated: true, durationSeconds: 60 }] }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/voice', { testAdmin: ADMIN_A });

  assert.equal(res.body.enabled, false);
  assert.equal(res.body.demoMode, true);
  assert.equal(res.body.providerName, 'mock');
  assert.equal(res.body.stats.totalCalls, 1);
  assert.equal(res.body.stats.appointmentConversions, 1);
});

test('EMERGENCY SAFETY IS ALWAYS REPORTED ON: admins are never given a toggle to disable it', async () => {
  const router = buildAdminVoiceRouter({ requireAuthMiddleware: fakeAuthMiddleware, callLogRepository: fakeCallLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/voice', { testAdmin: ADMIN_A });
  assert.equal(res.body.emergencySafetyAlwaysOn, true);
});

test('PRACTICE ISOLATION: admin B never sees admin A\'s call stats', async () => {
  const router = buildAdminVoiceRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    callLogRepository: fakeCallLogRepository({ 'practice-a': [{ turnCount: 5 }, { turnCount: 2 }] }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/voice', { testAdmin: ADMIN_B });
  assert.equal(res.body.stats.totalCalls, 0, 'practice-b must not see practice-a\'s call count');
});

test('CALL HISTORY: returns this practice\'s calls with the fields the admin UI needs, never another practice\'s', async () => {
  const router = buildAdminVoiceRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    callLogRepository: fakeCallLogRepository({
      'practice-a': [{ _id: 'c1', callSid: 'CA1', fromNumber: '+1555', status: 'completed', outcome: 'appointment_booked', appointmentCreated: true, turnCount: 6, startedAt: new Date() }],
      'practice-b': [{ _id: 'c2', callSid: 'CA2', fromNumber: '+1777', status: 'completed', outcome: 'faq_only', turnCount: 2, startedAt: new Date() }],
    }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/call-history', { testAdmin: ADMIN_A });

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].callSid, 'CA1');
  assert.equal(res.body[0].appointmentCreated, true);
});

test('UNAUTHENTICATED: both endpoints require a valid admin session', async () => {
  const router = buildAdminVoiceRouter({ requireAuthMiddleware: fakeAuthMiddleware, callLogRepository: fakeCallLogRepository() });
  const r1 = await invokeRoute(router, 'GET', '/admin/voice', {});
  const r2 = await invokeRoute(router, 'GET', '/admin/call-history', {});
  assert.equal(r1.res.statusCode, 401);
  assert.equal(r2.res.statusCode, 401);
});
