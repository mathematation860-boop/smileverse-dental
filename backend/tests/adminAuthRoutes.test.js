const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { buildAdminAuthRouter } = require('../routes/adminAuth');

function buildRouter(overrides = {}) {
  return buildAdminAuthRouter({
    attemptLogin: overrides.attemptLogin,
    isConfigured: overrides.isConfigured || (() => true),
    requireAuthMiddleware: overrides.requireAuthMiddleware || ((req, res, next) => next()),
  });
}

function baseReq(body = {}) {
  return { practiceId: 'practice-a', body, cookies: {} };
}

test('login route: success sets the session cookie and returns the admin profile, never a token/hash in the body', async () => {
  const router = buildRouter({
    attemptLogin: async () => ({ outcome: 'success', admin: { id: 'a1', email: 'alice@a.com', role: 'practice_admin', practiceId: 'practice-a' }, token: 'signed-jwt-value' }),
  });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'alice@a.com', password: 'x' }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.admin.email, 'alice@a.com');
  assert.equal(JSON.stringify(res.body).includes('signed-jwt-value'), false, 'the raw token must never appear in the JSON body');
  assert.ok(res.cookies.smileverse_admin_session);
  assert.equal(res.cookies.smileverse_admin_session.value, 'signed-jwt-value');
  assert.equal(res.cookies.smileverse_admin_session.opts.httpOnly, true);
});

test('login route: invalid credentials returns 401 with a generic message', async () => {
  const router = buildRouter({ attemptLogin: async () => ({ outcome: 'invalid_credentials' }) });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'x@a.com', password: 'wrong' }));
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /invalid email or password/i);
});

test('login route: disabled account returns 403', async () => {
  const router = buildRouter({ attemptLogin: async () => ({ outcome: 'disabled' }) });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'dana@a.com', password: 'x' }));
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /disabled/i);
});

test('login route: rate-limited lockout returns 429', async () => {
  const router = buildRouter({ attemptLogin: async () => ({ outcome: 'locked', retryAfterSeconds: 300 }) });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'x@a.com', password: 'x' }));
  assert.equal(res.statusCode, 429);
});

test('login route: missing email/password is a 400 before attemptLogin is even called', async () => {
  let called = false;
  const router = buildRouter({ attemptLogin: async () => { called = true; return { outcome: 'success' }; } });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: '', password: '' }));
  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});

test('login route: server error is never leaked to the client', async () => {
  const router = buildRouter({ attemptLogin: async () => { throw new Error('mongo connection refused at 10.0.0.5:27017'); } });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'x@a.com', password: 'x' }));
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes('10.0.0.5'), false);
});

test('login route: 500 if ADMIN_JWT_SECRET is not configured', async () => {
  const router = buildRouter({ isConfigured: () => false });
  const { res } = await invokeRoute(router, 'POST', '/admin/login', baseReq({ email: 'x@a.com', password: 'x' }));
  assert.equal(res.statusCode, 500);
});

test('logout route: always clears the session cookie', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(router, 'POST', '/admin/logout', baseReq());
  assert.equal(res.body.success, true);
  assert.ok(res.clearedCookies.find((c) => c.name === 'smileverse_admin_session'));
});

test('me route: returns req.admin when authenticated', async () => {
  const router = buildRouter({
    requireAuthMiddleware: (req, res, next) => {
      req.admin = { id: 'a1', email: 'alice@a.com', role: 'practice_admin', practiceId: 'practice-a' };
      next();
    },
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/me', baseReq());
  assert.equal(res.body.admin.email, 'alice@a.com');
});

test('me route: protected — an unauthenticated request never reaches the handler', async () => {
  const router = buildRouter({
    requireAuthMiddleware: (req, res) => res.status(401).json({ error: 'Not authenticated.' }),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/me', baseReq());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.admin, undefined);
});
