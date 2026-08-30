const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAuthMiddleware } = require('../middleware/authMiddleware');

// In-memory fakes standing in for sessionTokens/AdminUserRepository/practiceRepository —
// same DI-for-testability pattern as GoogleCalendarAppointmentProvider (Phase 2).
const PRACTICE_A = { practiceId: 'practice-a', name: 'Clinic A' };
const PRACTICE_B = { practiceId: 'practice-b', name: 'Clinic B' };

const ADMINS = {
  'admin-a1': { _id: 'admin-a1', practiceId: 'practice-a', role: 'practice_admin', name: 'Alice', email: 'alice@a.com', active: true },
  'admin-b1': { _id: 'admin-b1', practiceId: 'practice-b', role: 'practice_admin', name: 'Bob', email: 'bob@b.com', active: true },
  'admin-disabled': { _id: 'admin-disabled', practiceId: 'practice-a', role: 'practice_admin', name: 'Dana', email: 'dana@a.com', active: false },
};

function fakeVerifyToken(token) {
  if (!token || !ADMINS[token]) return null;
  const admin = ADMINS[token];
  return { adminId: admin._id, practiceId: admin.practiceId, role: admin.role };
}

async function fakeFindByIdInPractice(practiceId, adminId) {
  const admin = ADMINS[adminId];
  if (!admin || admin.practiceId !== practiceId) return null;
  return admin;
}

async function fakeResolvePractice(practiceId) {
  if (practiceId === 'practice-a') return PRACTICE_A;
  if (practiceId === 'practice-b') return PRACTICE_B;
  return null;
}

function buildMiddleware() {
  return buildAuthMiddleware({
    verifyToken: fakeVerifyToken,
    findByIdInPractice: fakeFindByIdInPractice,
    resolvePractice: fakeResolvePractice,
  });
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('requireAuth rejects a request with no session cookie', async () => {
  const { requireAuth } = buildMiddleware();
  const req = { cookies: {} };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth()(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects an unknown/tampered token', async () => {
  const { requireAuth } = buildMiddleware();
  const req = { cookies: { smileverse_admin_session: 'not-a-real-token' } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth()(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireAuth rejects a disabled account even with a valid token', async () => {
  const { requireAuth } = buildMiddleware();
  const req = { cookies: { smileverse_admin_session: 'admin-disabled' } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth()(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireAuth accepts a valid token and attaches req.admin/req.practice', async () => {
  const { requireAuth } = buildMiddleware();
  const req = { cookies: { smileverse_admin_session: 'admin-a1' } };
  const res = mockRes();
  let nextCalled = false;
  await requireAuth()(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  assert.equal(req.admin.practiceId, 'practice-a');
  assert.equal(req.practice.practiceId, 'practice-a');
  assert.equal(req.practiceId, 'practice-a');
});

test('PRACTICE ISOLATION: an X-Practice-Id header claiming a different practice is ignored', async () => {
  const { requireAuth } = buildMiddleware();
  // Simulate practiceContext having already run and set req.practice to
  // whatever a malicious header requested — requireAuth must overwrite it.
  const req = {
    cookies: { smileverse_admin_session: 'admin-a1' },
    headers: { 'x-practice-id': 'practice-b' },
    practice: PRACTICE_B,
    practiceId: 'practice-b',
  };
  const res = mockRes();
  await requireAuth()(req, res, () => {});
  assert.equal(req.practice.practiceId, 'practice-a', 'admin-a1 must only ever resolve to practice-a, never the header value');
  assert.equal(req.practiceId, 'practice-a');
});

test('PRACTICE ISOLATION: admin from practice A cannot be resolved against practice B via a forged token claim', async () => {
  const { requireAuth } = buildMiddleware();
  // fakeVerifyToken always returns the admin's REAL practiceId regardless of
  // what a forged claim might ask for, mirroring how a real JWT is signed
  // server-side at login and cannot be edited by the client afterward.
  const req = { cookies: { smileverse_admin_session: 'admin-a1' } };
  const res = mockRes();
  await requireAuth()(req, res, () => {});
  assert.notEqual(req.admin.practiceId, 'practice-b');
});

test('requireRole allows a matching role and blocks others', () => {
  const { requireRole } = buildMiddleware();
  const resAllow = mockRes();
  let allowed = false;
  requireRole('practice_admin', 'super_admin')({ admin: { role: 'practice_admin' } }, resAllow, () => (allowed = true));
  assert.equal(allowed, true);

  const resBlock = mockRes();
  let blocked = false;
  requireRole('super_admin')({ admin: { role: 'practice_admin' } }, resBlock, () => (blocked = true));
  assert.equal(blocked, false);
  assert.equal(resBlock.statusCode, 403);
});

test('requireRole blocks when req.admin is missing entirely', () => {
  const { requireRole } = buildMiddleware();
  const res = mockRes();
  let called = false;
  requireRole('practice_admin')({}, res, () => (called = true));
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
});
