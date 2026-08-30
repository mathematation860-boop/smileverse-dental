/**
 * routes/adminPMS.js (Phase 6 spec §5/§6/§21) — the admin-facing Open
 * Dental status/settings surface. Mirrors tests/adminNotificationsRoutes.test.js
 * and tests/adminVoiceRoutes.test.js's DI/harness conventions (invokeRoute +
 * a fake requireAuthMiddleware), but this router reads `req.practice`
 * directly (set by auth middleware from the authenticated session), so
 * each test injects its own middleware via `authAs(practice, admin)`
 * rather than reusing the shared static PRACTICES fixture — needed to
 * exercise demoMode/pmsProvider/isConfigured() combinations per test.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { fakeAuthMiddleware, ADMIN_A, ADMIN_B } = require('./helpers/fakeAuth');
const { buildAdminPMSRouter } = require('../routes/adminPMS');

function authAs(practice, admin) {
  return (req, res, next) => {
    req.admin = admin;
    req.practiceId = admin.practiceId;
    req.practice = practice;
    next();
  };
}

function fakePmsProviders({ providerName = 'mock', isConfigured = true, enabled = true, testConnectionResult } = {}) {
  const provider = {
    providerName,
    isConfigured: () => isConfigured,
    testConnection: async () =>
      testConnectionResult || { success: true, provider: providerName, latencyMs: 42, apiVersion: '23.1', apiKey: 'THIS-MUST-NEVER-LEAK' },
  };
  return {
    isPmsEnabled: () => enabled,
    getPMSProvider: () => (enabled ? provider : null),
  };
}

function fakePmsAuditLogRepository(seed = []) {
  const events = [...seed];
  return {
    events,
    async record(practiceId, entry) {
      events.push({ practiceId, ...entry, createdAt: new Date() });
      return null;
    },
    async listForPractice(practiceId) {
      return events.filter((e) => e.practiceId === practiceId).reverse();
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

const DEMO_PRACTICE = { practiceId: 'practice-a', demoMode: true, integrations: { pmsProvider: 'openDental' }, pms: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: 1 } }, providerMappings: {}, operatoryMappings: {} } };
const NOT_ENABLED_PRACTICE = { practiceId: 'practice-a', demoMode: false, integrations: { pmsProvider: 'none' }, pms: {} };
const NOT_CONFIGURED_PRACTICE = { practiceId: 'practice-a', demoMode: false, integrations: { pmsProvider: 'openDental' }, pms: {} };
const CONNECTED_PRACTICE = { practiceId: 'practice-a', demoMode: false, integrations: { pmsProvider: 'openDental' }, pms: {} };

test('DEMO MODE: always reports status "demo" and the fixed disclosure message, even though pmsProvider is configured to openDental', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: authAs(DEMO_PRACTICE, ADMIN_A), pmsProviders: fakePmsProviders({ providerName: 'mock', enabled: true }), pmsAuditLogRepository: fakePmsAuditLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_A });

  assert.equal(res.body.demoMode, true);
  assert.equal(res.body.status, 'demo');
  assert.equal(res.body.statusMessage, 'Demo Mode — Open Dental is not connected.');
});

test('NOT ENABLED: pmsProvider "none" reports status "not_enabled", never a fake connected/demo status', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: authAs(NOT_ENABLED_PRACTICE, ADMIN_A), pmsProviders: fakePmsProviders({ enabled: false }), pmsAuditLogRepository: fakePmsAuditLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_A });

  assert.equal(res.body.pmsEnabled, false);
  assert.equal(res.body.status, 'not_enabled');
  assert.equal(res.body.providerName, null);
});

test('PRODUCTION, NOT YET CONFIGURED: demoMode off + a real provider selected but missing credentials reports "not_connected", never "connected"', async () => {
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(NOT_CONFIGURED_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders({ providerName: 'openDental', isConfigured: false, enabled: true }),
    pmsAuditLogRepository: fakePmsAuditLogRepository(),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_A });

  assert.equal(res.body.status, 'not_connected');
  assert.equal(res.body.providerConfigured, false);
});

test('PRODUCTION, CONFIGURED: demoMode off + real provider + genuine credentials reports "connected" — the ONLY path that ever says so', async () => {
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(CONNECTED_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders({ providerName: 'openDental', isConfigured: true, enabled: true }),
    pmsAuditLogRepository: fakePmsAuditLogRepository(),
  });
  const { res } = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_A });

  assert.equal(res.body.status, 'connected');
  assert.equal(res.body.providerConfigured, true);
  assert.equal(res.body.providerName, 'openDental');
});

test('MAPPING COUNTS: reflects this practice\'s own configured service/provider/operatory mappings, never invented numbers', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: authAs(DEMO_PRACTICE, ADMIN_A), pmsProviders: fakePmsProviders(), pmsAuditLogRepository: fakePmsAuditLogRepository() });
  const { res } = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_A });
  assert.equal(res.body.mappings.serviceMappingCount, 1);
  assert.equal(res.body.mappings.providerMappingCount, 0);
  assert.equal(res.body.mappings.operatoryMappingCount, 0);
});

test('TEST CONNECTION: a successful test returns provider/latency/apiVersion but NEVER any credential-shaped field, and is recorded to the audit log', async () => {
  const auditRepo = fakePmsAuditLogRepository();
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(CONNECTED_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders({ providerName: 'openDental', isConfigured: true }),
    pmsAuditLogRepository: auditRepo,
  });
  const { res } = await invokeRoute(router, 'POST', '/admin/pms/test-connection', { testAdmin: ADMIN_A });

  assert.equal(res.body.success, true);
  assert.equal(res.body.provider, 'openDental');
  assert.equal(res.body.latencyMs, 42);
  assert.equal(res.body.apiVersion, '23.1');
  assert.equal(res.body.apiKey, undefined, 'a credential field returned by the provider must never be forwarded to the frontend');
  assert.equal(JSON.stringify(res.body).toLowerCase().includes('never-leak'), false);

  assert.equal(auditRepo.events.length, 1);
  assert.equal(auditRepo.events[0].event, 'connection_test');
  assert.equal(auditRepo.events[0].outcome, 'success');
});

test('TEST CONNECTION: PMS not enabled for this practice fails safely with PMS_NOT_ENABLED, never throws', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: authAs(NOT_ENABLED_PRACTICE, ADMIN_A), pmsProviders: fakePmsProviders({ enabled: false }), pmsAuditLogRepository: fakePmsAuditLogRepository() });
  const { res } = await invokeRoute(router, 'POST', '/admin/pms/test-connection', { testAdmin: ADMIN_A });

  assert.equal(res.body.success, false);
  assert.equal(res.body.provider, null);
  assert.equal(res.body.error, 'PMS_NOT_ENABLED');
});

test('TEST CONNECTION: a failed test is recorded to the audit log with the failure reason, never fabricated as success', async () => {
  const auditRepo = fakePmsAuditLogRepository();
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(CONNECTED_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders({ providerName: 'openDental', isConfigured: true, testConnectionResult: { success: false, provider: 'openDental', error: 'PMS_AUTH_FAILED' } }),
    pmsAuditLogRepository: auditRepo,
  });
  const { res } = await invokeRoute(router, 'POST', '/admin/pms/test-connection', { testAdmin: ADMIN_A });

  assert.equal(res.body.success, false);
  assert.equal(auditRepo.events[0].outcome, 'failure');
  assert.equal(auditRepo.events[0].failureReason, 'PMS_AUTH_FAILED');
});

test('PMS SETTINGS: GET/PUT round-trips ID mappings only, scoped to the authenticated practice', async () => {
  const practiceSettingsRepository = fakePracticeSettingsRepository();
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(DEMO_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders(),
    pmsAuditLogRepository: fakePmsAuditLogRepository(),
    practiceSettingsRepository,
    getPracticeResolved: async (practiceId) => ({ practiceId, pms: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '5' } }, providerMappings: {}, operatoryMappings: {} } }),
  });

  const putRes = await invokeRoute(router, 'PUT', '/admin/pms-settings', {
    testAdmin: ADMIN_A,
    body: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '5' } }, providerMappings: {}, operatoryMappings: {} },
  });
  assert.equal(putRes.res.body.success, true);
  assert.deepEqual(practiceSettingsRepository.saved.get('practice-a').pms.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '5' } });

  const getRes = await invokeRoute(router, 'GET', '/admin/pms-settings', { testAdmin: ADMIN_A });
  assert.deepEqual(getRes.res.body.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '5' } });
});

test('PMS SETTINGS: never accepts a credential-shaped field — even if the request body includes one, it is rejected or stripped, never persisted', async () => {
  const practiceSettingsRepository = fakePracticeSettingsRepository();
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(DEMO_PRACTICE, ADMIN_A),
    pmsProviders: fakePmsProviders(),
    pmsAuditLogRepository: fakePmsAuditLogRepository(),
    practiceSettingsRepository,
  });
  const { res } = await invokeRoute(router, 'PUT', '/admin/pms-settings', {
    testAdmin: ADMIN_A,
    body: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {}, apiKey: 'sneaky-secret', developerKey: 'also-sneaky' },
  });

  if (res.statusCode === 400) {
    assert.ok(true, 'rejecting the whole patch outright is an acceptable, safe way to refuse a credential field');
  } else {
    const stored = practiceSettingsRepository.saved.get('practice-a');
    assert.equal(stored.pms.apiKey, undefined);
    assert.equal(stored.pms.developerKey, undefined);
  }
});

test('PMS SETTINGS: malformed mapping input is rejected with 400, never silently accepted', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: authAs(DEMO_PRACTICE, ADMIN_A), pmsProviders: fakePmsProviders(), pmsAuditLogRepository: fakePmsAuditLogRepository(), practiceSettingsRepository: fakePracticeSettingsRepository() });
  const { res } = await invokeRoute(router, 'PUT', '/admin/pms-settings', { testAdmin: ADMIN_A, body: { serviceMappings: 'not-an-object' } });
  assert.equal(res.statusCode, 400);
});

test('PRACTICE ISOLATION: admin B never sees admin A\'s PMS mappings, status, or audit history', async () => {
  const auditRepo = fakePmsAuditLogRepository([{ practiceId: 'practice-a', event: 'connection_test', outcome: 'success', createdAt: new Date() }]);
  const practiceB = { practiceId: 'practice-b', demoMode: true, integrations: { pmsProvider: 'none' }, pms: {} };
  const router = buildAdminPMSRouter({
    requireAuthMiddleware: authAs(practiceB, ADMIN_B),
    pmsProviders: fakePmsProviders({ enabled: false }),
    pmsAuditLogRepository: auditRepo,
    getPracticeResolved: async (practiceId) => ({ practiceId, pms: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {} } }),
  });

  const statusRes = await invokeRoute(router, 'GET', '/admin/pms', { testAdmin: ADMIN_B });
  assert.equal(statusRes.res.body.lastSuccessfulTestAt, null, 'practice-b must never see practice-a\'s successful connection test');

  const settingsRes = await invokeRoute(router, 'GET', '/admin/pms-settings', { testAdmin: ADMIN_B });
  assert.deepEqual(settingsRes.res.body.serviceMappings, {});
});

test('UNAUTHENTICATED: every PMS endpoint requires a valid admin session', async () => {
  const router = buildAdminPMSRouter({ requireAuthMiddleware: fakeAuthMiddleware, pmsProviders: fakePmsProviders(), pmsAuditLogRepository: fakePmsAuditLogRepository() });
  const r1 = await invokeRoute(router, 'GET', '/admin/pms', {});
  const r2 = await invokeRoute(router, 'POST', '/admin/pms/test-connection', {});
  const r3 = await invokeRoute(router, 'GET', '/admin/pms-settings', {});
  const r4 = await invokeRoute(router, 'PUT', '/admin/pms-settings', { body: {} });
  assert.equal(r1.res.statusCode, 401);
  assert.equal(r2.res.statusCode, 401);
  assert.equal(r3.res.statusCode, 401);
  assert.equal(r4.res.statusCode, 401);
});
