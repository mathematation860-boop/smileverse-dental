const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminSettingsRouter } = require('../routes/adminSettings');

const BASE_PRACTICE_A = { practiceId: 'practice-a', demoMode: true, name: 'Clinic A', hours: {}, services: [], insurance: {}, faqs: [], cancellationPolicy: { summary: '' }, emergencyPolicy: { summary: '' } };
const BASE_PRACTICE_B = { practiceId: 'practice-b', demoMode: true, name: 'Clinic B', hours: {}, services: [], insurance: {}, faqs: [], cancellationPolicy: { summary: '' }, emergencyPolicy: { summary: '' } };

function fakeStore() {
  const overridesByPractice = new Map(); // practiceId -> patch
  return {
    async get(practiceId) {
      return overridesByPractice.get(practiceId) || null;
    },
    async upsert(practiceId, patch, adminId) {
      const existing = overridesByPractice.get(practiceId) || {};
      overridesByPractice.set(practiceId, { ...existing, ...patch, updatedBy: adminId });
      return overridesByPractice.get(practiceId);
    },
    _raw: overridesByPractice,
  };
}

function buildRouter(store) {
  return buildAdminSettingsRouter({
    requireAuthMiddleware: fakeAuthMiddleware,
    practiceSettingsRepository: store,
    getPracticeResolved: async (practiceId) => {
      const base = practiceId === 'practice-a' ? BASE_PRACTICE_A : BASE_PRACTICE_B;
      const overrides = await store.get(practiceId);
      return { ...base, ...overrides, name: overrides?.name || base.name };
    },
  });
}

test('PUT /admin/settings: a valid patch is saved for the authenticated admin practice', async () => {
  const store = fakeStore();
  const router = buildRouter(store);
  const { res } = await invokeRoute(router, 'PUT', '/admin/settings', {
    testAdmin: ADMIN_A,
    body: { name: 'Clinic A New Name', phone: '+1-555-1234' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(store._raw.get('practice-a').name, 'Clinic A New Name');
});

test('PUT /admin/settings: an invalid patch (script injection) is rejected with 400 and never saved', async () => {
  const store = fakeStore();
  const router = buildRouter(store);
  const { res } = await invokeRoute(router, 'PUT', '/admin/settings', {
    testAdmin: ADMIN_A,
    body: { name: '<script>alert(1)</script>' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(store._raw.has('practice-a'), false);
});

test('PUT /admin/settings: unauthenticated request is rejected before reaching the repository', async () => {
  const store = fakeStore();
  const router = buildRouter(store);
  const { res } = await invokeRoute(router, 'PUT', '/admin/settings', { body: { name: 'Hacked Name' } });
  assert.equal(res.statusCode, 401);
  assert.equal(store._raw.size, 0);
});

test('PRACTICE ISOLATION: admin B saving settings never touches practice A\'s stored overrides', async () => {
  const store = fakeStore();
  const router = buildRouter(store);
  await invokeRoute(router, 'PUT', '/admin/settings', { testAdmin: ADMIN_A, body: { name: 'Clinic A Updated' } });
  await invokeRoute(router, 'PUT', '/admin/settings', { testAdmin: ADMIN_B, body: { name: 'Clinic B Updated' } });

  assert.equal(store._raw.get('practice-a').name, 'Clinic A Updated');
  assert.equal(store._raw.get('practice-b').name, 'Clinic B Updated');
});

test('GET /admin/settings: returns only the authenticated admin\'s own practice data', async () => {
  const store = fakeStore();
  await store.upsert('practice-a', { name: 'Clinic A Saved' }, ADMIN_A.id);
  await store.upsert('practice-b', { name: 'Clinic B Saved' }, ADMIN_B.id);
  const router = buildRouter(store);

  const resultA = await invokeRoute(router, 'GET', '/admin/settings', { testAdmin: ADMIN_A });
  assert.equal(resultA.res.body.name, 'Clinic A Saved');

  const resultB = await invokeRoute(router, 'GET', '/admin/settings', { testAdmin: ADMIN_B });
  assert.equal(resultB.res.body.name, 'Clinic B Saved');
});

test('PUT /admin/ai-config: saves customInstructions only, rejects unsafe content', async () => {
  const store = fakeStore();
  const router = buildRouter(store);

  const ok = await invokeRoute(router, 'PUT', '/admin/ai-config', { testAdmin: ADMIN_A, body: { customInstructions: 'We now offer Saturday hours.' } });
  assert.equal(ok.res.statusCode, 200);
  assert.equal(store._raw.get('practice-a').aiConfig.customInstructions, 'We now offer Saturday hours.');

  const bad = await invokeRoute(router, 'PUT', '/admin/ai-config', { testAdmin: ADMIN_A, body: { customInstructions: '<script>evil()</script>' } });
  assert.equal(bad.res.statusCode, 400);
});
