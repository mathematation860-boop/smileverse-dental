const { test } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminHandoffsRouter } = require('../routes/adminHandoffs');

function fakeHandoffRepository(seed = {}) {
  const byPractice = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((h) => ({ ...h }))]));
  return {
    async findAll(practiceId) {
      return byPractice.get(practiceId) || [];
    },
    async updateStatus(practiceId, id, status) {
      const rows = byPractice.get(practiceId) || [];
      const row = rows.find((h) => h._id === id);
      if (!row) return null; // includes the case where `id` belongs to a DIFFERENT practice
      row.status = status;
      return row;
    },
    _byPractice: byPractice,
  };
}

test('HANDOFF MANAGEMENT: lists pending handoffs for the authenticated practice', async () => {
  const handoffRepository = fakeHandoffRepository({
    'practice-a': [{ _id: 'h1', status: 'pending', reason: 'uncertain', urgency: 'normal', createdAt: new Date() }],
  });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });
  const { res } = await invokeRoute(router, 'GET', '/admin/handoffs', { testAdmin: ADMIN_A });
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].status, 'pending');
});

test('HANDOFF MANAGEMENT: status can be moved pending -> assigned -> resolved', async () => {
  const handoffRepository = fakeHandoffRepository({ 'practice-a': [{ _id: 'h1', status: 'pending' }] });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });

  const r1 = await invokeRoute(router, 'PATCH', '/admin/handoffs/:id', { testAdmin: ADMIN_A, params: { id: 'h1' }, body: { status: 'assigned' } });
  assert.equal(r1.res.statusCode, 200);
  assert.equal(r1.res.body.data.status, 'assigned');

  const r2 = await invokeRoute(router, 'PATCH', '/admin/handoffs/:id', { testAdmin: ADMIN_A, params: { id: 'h1' }, body: { status: 'resolved' } });
  assert.equal(r2.res.body.data.status, 'resolved');
});

test('HANDOFF MANAGEMENT: rejects an invalid status value', async () => {
  const handoffRepository = fakeHandoffRepository({ 'practice-a': [{ _id: 'h1', status: 'pending' }] });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });
  const { res } = await invokeRoute(router, 'PATCH', '/admin/handoffs/:id', { testAdmin: ADMIN_A, params: { id: 'h1' }, body: { status: 'closed' } });
  assert.equal(res.statusCode, 400);
});

test('PRACTICE ISOLATION: admin B cannot update a handoff that belongs to practice A', async () => {
  const handoffRepository = fakeHandoffRepository({
    'practice-a': [{ _id: 'h1', status: 'pending' }],
    'practice-b': [],
  });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });
  const { res } = await invokeRoute(router, 'PATCH', '/admin/handoffs/:id', { testAdmin: ADMIN_B, params: { id: 'h1' }, body: { status: 'resolved' } });
  assert.equal(res.statusCode, 404);
  // and the practice-a row is untouched
  assert.equal(handoffRepository._byPractice.get('practice-a')[0].status, 'pending');
});

test('PRACTICE ISOLATION: admin B never sees practice A\'s handoffs in the list', async () => {
  const handoffRepository = fakeHandoffRepository({ 'practice-a': [{ _id: 'h1', status: 'pending' }], 'practice-b': [] });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });
  const { res } = await invokeRoute(router, 'GET', '/admin/handoffs', { testAdmin: ADMIN_B });
  assert.deepEqual(res.body, []);
});

test('unauthenticated request is rejected before touching the repository', async () => {
  const handoffRepository = fakeHandoffRepository({ 'practice-a': [{ _id: 'h1', status: 'pending' }] });
  const router = buildAdminHandoffsRouter({ requireAuthMiddleware: fakeAuthMiddleware, handoffRepository });
  const { res } = await invokeRoute(router, 'GET', '/admin/handoffs', {});
  assert.equal(res.statusCode, 401);
});
