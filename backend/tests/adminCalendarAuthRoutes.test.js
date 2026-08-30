const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminCalendarAuthRouter } = require('../routes/adminCalendarAuth');

function fakeCalendarDeps(seed = {}) {
  const connectionsByPractice = new Map(Object.entries(seed));
  return {
    calendarConnectionRepository: {
      async isConnected(practiceId) {
        return connectionsByPractice.get(practiceId) || null;
      },
      async remove(practiceId) {
        connectionsByPractice.delete(practiceId);
      },
    },
    oauthStateStore: { createState: (practiceId) => `state-for-${practiceId}` },
    googleOAuthClient: {
      isConfigured: () => true,
      buildAuthUrl: (state) => `https://accounts.google.com/o/oauth2/auth?state=${state}`,
    },
    _connectionsByPractice: connectionsByPractice,
  };
}

test('CALENDAR CONNECTION AUTHORIZATION: an authenticated admin can read their own connection status', async () => {
  const deps = fakeCalendarDeps({ 'practice-a': { connectedEmail: 'front-desk@clinic-a.com', calendarId: 'primary' } });
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/status', { testAdmin: ADMIN_A });
  assert.equal(res.body.connected, true);
  assert.equal(res.body.connectedEmail, 'front-desk@clinic-a.com');
});

test('CALENDAR CONNECTION AUTHORIZATION: the status response never includes a token/secret field', async () => {
  const deps = fakeCalendarDeps({ 'practice-a': { connectedEmail: 'x@y.com', calendarId: 'primary', refreshToken: 'should-never-appear', accessToken: 'should-never-appear-either' } });
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/status', { testAdmin: ADMIN_A });
  const serialized = JSON.stringify(res.body);
  assert.equal(serialized.includes('should-never-appear'), false);
});

test('UNAUTHORIZED CALENDAR ACCESS: an unauthenticated request is rejected before touching the repository', async () => {
  const deps = fakeCalendarDeps({ 'practice-a': { connectedEmail: 'x@y.com' } });
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/status', {});
  assert.equal(res.statusCode, 401);
});

test('PRACTICE ISOLATION: admin B\'s status check never reflects practice A\'s connection', async () => {
  const deps = fakeCalendarDeps({ 'practice-a': { connectedEmail: 'front-desk@clinic-a.com' } });
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/status', { testAdmin: ADMIN_B });
  assert.equal(res.body.connected, false);
  assert.equal(res.body.connectedEmail, null);
});

test('PRACTICE ISOLATION: admin B disconnecting never removes practice A\'s connection', async () => {
  const deps = fakeCalendarDeps({ 'practice-a': { connectedEmail: 'front-desk@clinic-a.com' }, 'practice-b': { connectedEmail: 'front-desk@clinic-b.com' } });
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  await invokeRoute(router, 'POST', '/admin/calendar/disconnect', { testAdmin: ADMIN_B });
  assert.equal(deps._connectionsByPractice.has('practice-a'), true, 'practice A connection must survive admin B\'s disconnect call');
  assert.equal(deps._connectionsByPractice.has('practice-b'), false);
});

test('oauth/start mints a state nonce for the AUTHENTICATED admin\'s own practiceId, never a client-supplied one', async () => {
  const deps = fakeCalendarDeps();
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  // Even if a malicious client sent a practiceId in the body/query, requireAuthMiddleware
  // (via fakeAuthMiddleware) is what actually sets req.practiceId — the route handler
  // never reads anything else.
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/oauth/start', {
    testAdmin: ADMIN_A,
    query: { practiceId: 'practice-b' },
    body: { practiceId: 'practice-b' },
  });
  assert.equal(res.redirectedTo, 'https://accounts.google.com/o/oauth2/auth?state=state-for-practice-a');
});

test('oauth/start returns 501 when Google OAuth is not configured on the server', async () => {
  const deps = fakeCalendarDeps();
  deps.googleOAuthClient.isConfigured = () => false;
  const router = buildAdminCalendarAuthRouter({ requireAuthMiddleware: fakeAuthMiddleware, ...deps });
  const { res } = await invokeRoute(router, 'GET', '/admin/calendar/oauth/start', { testAdmin: ADMIN_A });
  assert.equal(res.statusCode, 501);
});
