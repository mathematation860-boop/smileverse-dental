const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminNotificationsRouter } = require('../routes/adminNotifications');

function fakeNotificationLogRepository(seed = {}) {
  const byPractice = new Map(Object.entries(seed));
  return {
    async getSummary(practiceId) {
      const rows = byPractice.get(practiceId) || [];
      return {
        total: rows.length,
        sent: rows.filter((r) => r.status === 'sent').length,
        failed: rows.filter((r) => r.status === 'failed').length,
        simulated: rows.filter((r) => r.status === 'simulated').length,
        byChannel: { sms: rows.filter((r) => r.channel === 'sms').length, email: rows.filter((r) => r.channel === 'email').length },
      };
    },
    async listForPractice(practiceId) {
      return byPractice.get(practiceId) || [];
    },
  };
}

function fakePracticeSettingsRepository() {
  const saved = new Map();
  return {
    saved,
    async upsert(practiceId, patch) {
      saved.set(practiceId, { ...(saved.get(practiceId) || {}), ...patch });
      return saved.get(practiceId);
    },
  };
}

test('EMPTY HISTORY: a practice with no notifications yet reports real zeros, never sample data', async () => {
  const router = buildAdminNotificationsRouter({ requireAuthMiddleware: fakeAuthMiddleware, notificationLogRepository: fakeNotificationLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/notifications', { testAdmin: ADMIN_A });

  assert.equal(res.body.stats.total, 0);
  assert.equal(res.body.stats.sent, 0);
  assert.equal(res.body.stats.simulated, 0);
});

test('DEMO MODE NEVER REPORTS "live": even with notifications logged, a demoMode practice is never claimed as live SMS/email', async () => {
  const router = buildAdminNotificationsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    notificationLogRepository: fakeNotificationLogRepository({ 'practice-a': [{ status: 'simulated', channel: 'sms' }] }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/notifications', { testAdmin: ADMIN_A });

  assert.equal(res.body.demoMode, true);
  assert.equal(res.body.smsLive, false);
  assert.equal(res.body.emailLive, false);
  assert.equal(res.body.stats.total, 1);
  assert.equal(res.body.stats.simulated, 1);
});

test('EMERGENCY ALERTS ALWAYS REPORTED ON: admins are never given a toggle to disable them', async () => {
  const router = buildAdminNotificationsRouter({ requireAuthMiddleware: fakeAuthMiddleware, notificationLogRepository: fakeNotificationLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/notifications', { testAdmin: ADMIN_A });
  assert.equal(res.body.emergencyAlertsAlwaysOn, true);
});

test('PRACTICE ISOLATION: admin B never sees admin A\'s notification stats or history', async () => {
  const router = buildAdminNotificationsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    notificationLogRepository: fakeNotificationLogRepository({ 'practice-a': [{ status: 'sent', channel: 'sms' }, { status: 'sent', channel: 'email' }] }),
  });
  const statusRes = await invokeRoute(router, 'GET', '/admin/notifications', { testAdmin: ADMIN_B });
  const historyRes = await invokeRoute(router, 'GET', '/admin/notification-history', { testAdmin: ADMIN_B });

  assert.equal(statusRes.res.body.stats.total, 0, 'practice-b must not see practice-a\'s counts');
  assert.equal(historyRes.res.body.length, 0, 'practice-b must not see practice-a\'s history rows');
});

test('NOTIFICATION HISTORY: returns this practice\'s rows with masked destinations, never provider secrets/message ids', async () => {
  const router = buildAdminNotificationsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    notificationLogRepository: fakeNotificationLogRepository({
      'practice-a': [{ _id: 'n1', type: 'appointment_confirmation', channel: 'sms', destinationMasked: '***4567', status: 'sent', provider: 'twilio', providerMessageId: 'SM_SECRET_ID', createdAt: new Date() }],
    }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/notification-history', { testAdmin: ADMIN_A });

  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].destinationMasked, '***4567');
  assert.equal(res.body[0].providerMessageId, undefined, 'the internal provider message id must never reach the frontend');
});

test('NOTIFICATION SETTINGS: GET/PUT round-trips channel toggles and reminder offsets, scoped to the authenticated practice', async () => {
  const practiceSettingsRepository = fakePracticeSettingsRepository();
  const router = buildAdminNotificationsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    notificationLogRepository: fakeNotificationLogRepository(),
    practiceSettingsRepository,
    getPracticeResolved: async (practiceId) => ({ practiceId, notifications: { smsEnabled: false, reminderOffsetsHours: [48, 2] } }),
  });

  const putRes = await invokeRoute(router, 'PUT', '/admin/notification-settings', { testAdmin: ADMIN_A, body: { smsEnabled: false, emailEnabled: true, reminderOffsetsHours: [48, 2] } });
  assert.equal(putRes.res.body.success, true);
  assert.deepEqual(practiceSettingsRepository.saved.get('practice-a').notifications, { smsEnabled: false, emailEnabled: true, reminderOffsetsHours: [48, 2] });

  const getRes = await invokeRoute(router, 'GET', '/admin/notification-settings', { testAdmin: ADMIN_A });
  assert.equal(getRes.res.body.smsEnabled, false);
  assert.deepEqual(getRes.res.body.reminderOffsetsHours, [48, 2]);
});

test('NOTIFICATION SETTINGS: invalid input is rejected with 400, never silently accepted', async () => {
  const router = buildAdminNotificationsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    notificationLogRepository: fakeNotificationLogRepository(),
    practiceSettingsRepository: fakePracticeSettingsRepository(),
  });
  const { res } = await invokeRoute(router, 'PUT', '/admin/notification-settings', { testAdmin: ADMIN_A, body: { reminderOffsetsHours: ['not-a-number'] } });
  assert.equal(res.statusCode, 400);
});

test('UNAUTHENTICATED: every endpoint requires a valid admin session', async () => {
  const router = buildAdminNotificationsRouter({ requireAuthMiddleware: fakeAuthMiddleware, notificationLogRepository: fakeNotificationLogRepository() });
  const r1 = await invokeRoute(router, 'GET', '/admin/notifications', {});
  const r2 = await invokeRoute(router, 'GET', '/admin/notification-history', {});
  const r3 = await invokeRoute(router, 'GET', '/admin/notification-settings', {});
  assert.equal(r1.res.statusCode, 401);
  assert.equal(r2.res.statusCode, 401);
  assert.equal(r3.res.statusCode, 401);
});
