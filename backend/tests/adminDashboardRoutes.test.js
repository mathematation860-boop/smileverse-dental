const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminDashboardRouter } = require('../routes/adminDashboard');

function fakeRepos({ appointmentsByPractice = {}, leadsByPractice = {}, handoffsByPractice = {}, eventCountsByPractice = {} } = {}) {
  return {
    appointmentRepository: { findAll: async (practiceId) => appointmentsByPractice[practiceId] || [] },
    leadRepository: { findAll: async (practiceId) => leadsByPractice[practiceId] || [] },
    conversationRepository: { listConversations: (practiceId) => (practiceId === 'practice-a' ? [{ conversationId: 'c1' }, { conversationId: 'c2' }] : []) },
    handoffRepository: { findAll: async (practiceId) => handoffsByPractice[practiceId] || [] },
    analyticsRepository: {
      getEventCounts: async (practiceId) => eventCountsByPractice[practiceId] || {},
      getSummary: async (practiceId) => [{ name: 'conversation_started', count: practiceId === 'practice-a' ? 5 : 0 }],
    },
  };
}

test('DASHBOARD DATA: an empty practice reports real zeros, never invented numbers', async () => {
  const router = buildAdminDashboardRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...fakeRepos() });
  const { res } = await invokeRoute(router, 'GET', '/admin/dashboard/overview', { testAdmin: ADMIN_A });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.today.appointments, 0);
  assert.equal(res.body.upcomingAppointments, 0);
  assert.equal(res.body.cancellations, 0);
  assert.equal(res.body.newLeads, 0);
  assert.equal(res.body.pendingHandoffs, 0);
  assert.equal(res.body.demoMode, true);
});

test('DASHBOARD DATA: today/upcoming/cancelled counts are computed from real appointment records', async () => {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const router = buildAdminDashboardRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    ...fakeRepos({
      appointmentsByPractice: {
        'practice-a': [
          { date: todayStr, status: 'Confirmed' },
          { date: todayStr, status: 'Cancelled' }, // cancelled today doesn't count as "today's appointments"
          { date: '2099-01-01', status: 'Confirmed' }, // far future -> upcoming
          { date: '2020-01-01', status: 'Cancelled' }, // past cancellation
        ],
      },
    }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/dashboard/overview', { testAdmin: ADMIN_A });
  assert.equal(res.body.today.appointments, 1);
  assert.equal(res.body.upcomingAppointments, 1);
  assert.equal(res.body.cancellations, 2);
});

test('PRACTICE ISOLATION: admin B\'s overview never reflects practice A\'s data', async () => {
  const router = buildAdminDashboardRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    ...fakeRepos({
      appointmentsByPractice: { 'practice-a': [{ date: '2099-01-01', status: 'Confirmed' }] },
      handoffsByPractice: { 'practice-a': [{ status: 'pending' }, { status: 'pending' }] },
    }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/dashboard/overview', { testAdmin: ADMIN_B });
  assert.equal(res.body.upcomingAppointments, 0);
  assert.equal(res.body.pendingHandoffs, 0);
  assert.equal(res.body.conversations, 0); // fakeRepos only seeds conversations for practice-a
});

test('unauthenticated dashboard request is rejected', async () => {
  const router = buildAdminDashboardRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...fakeRepos() });
  const { res } = await invokeRoute(router, 'GET', '/admin/dashboard/overview', {});
  assert.equal(res.statusCode, 401);
});

test('GET /admin/analytics returns the practice-scoped event summary', async () => {
  const router = buildAdminDashboardRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...fakeRepos() });
  const { res } = await invokeRoute(router, 'GET', '/admin/analytics', { testAdmin: ADMIN_A });
  assert.equal(res.body.summary[0].count, 5);
});

test('GET /admin/patients derives a real patient list from appointment history, grouped by phone', async () => {
  const router = buildAdminDashboardRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    ...fakeRepos({
      appointmentsByPractice: {
        'practice-a': [
          { phone: '+1-555-0001', name: 'Jane Doe', email: 'jane@x.com', date: '2024-01-01', status: 'Confirmed', confirmedAt: new Date('2024-01-01') },
          { phone: '+1-555-0001', name: 'Jane Doe', email: 'jane@x.com', date: '2099-01-01', status: 'Confirmed', confirmedAt: new Date('2024-06-01') },
          { phone: '+1-555-0002', name: 'John Roe', email: 'john@x.com', date: '2024-02-01', status: 'Confirmed', confirmedAt: new Date('2024-02-01') },
        ],
      },
    }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/patients', { testAdmin: ADMIN_A });
  assert.equal(res.body.length, 2);
  const jane = res.body.find((p) => p.phone === '+1-555-0001');
  assert.equal(jane.appointmentCount, 2);
  assert.equal(jane.upcomingCount, 1);
});
