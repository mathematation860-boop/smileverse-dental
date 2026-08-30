/**
 * Admin PMS (Open Dental) settings/status page (Phase 6 spec §5/§6).
 *
 * Mirrors routes/adminNotifications.js's structure and honesty rules:
 *  - "Connected"/"live" never claims more than genuinely true — it
 *    requires demoMode explicitly off, `integrations.pmsProvider` set to
 *    a real provider, AND that provider's own `isConfigured()` reporting
 *    real credentials present (spec §3/§30: never claim a real PMS
 *    connection without real credentials and a real test).
 *  - Demo Mode always reports plainly as "Demo Mode — Open Dental is not
 *    connected" (spec §3) — never a fake "Connected" status, never
 *    invented patient/sync counts.
 *  - Test Connection performs a genuine, safe, read-only request through
 *    the SAME provider abstraction the receptionist uses — never a
 *    separate, parallel "looks like it should work" check — and never
 *    creates/modifies a patient or appointment (spec §6).
 *  - Settings here are ID-mapping-only (never credentials — see
 *    services/practice/settingsValidation.js's validatePmsSettingsPatch
 *    header comment for why raw API keys are never accepted through any
 *    admin endpoint in this codebase).
 *  - practiceId always comes from the authenticated admin session
 *    (req.practiceId/req.practice), never the request body/params (spec
 *    §21: "never trust a caller-supplied practiceId").
 *
 * `buildAdminPMSRouter(deps)` mirrors every other Phase 3/4/5 admin
 * router's DI pattern — see tests/adminPMSRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const pmsProvidersReal = require('../services/pms');
const pmsAuditLogRepositoryReal = require('../repositories/PMSAuditLogRepository');
const practiceSettingsRepositoryReal = require('../repositories/PracticeSettingsRepository');
const { getPracticeResolved: getPracticeResolvedReal } = require('../config/practiceRepository');
const { validatePmsSettingsPatch } = require('../services/practice/settingsValidation');

function mappingCount(obj) {
  return obj && typeof obj === 'object' ? Object.keys(obj).length : 0;
}

function buildAdminPMSRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const pmsProviders = deps.pmsProviders || pmsProvidersReal;
  const pmsAuditLogRepository = deps.pmsAuditLogRepository || pmsAuditLogRepositoryReal;
  const practiceSettingsRepository = deps.practiceSettingsRepository || practiceSettingsRepositoryReal;
  const getPracticeResolved = deps.getPracticeResolved || getPracticeResolvedReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/pms -> status tile row + mapping configuration summary.
  router.get('/admin/pms', async (req, res) => {
    try {
      const practice = req.practice;
      const demoMode = practice.demoMode !== false;
      const pmsEnabled = pmsProviders.isPmsEnabled(practice);
      const provider = pmsProviders.getPMSProvider(practice);

      // "Connected"/live requires ALL of: PMS turned on for this
      // practice, demoMode explicitly off, a real (non-mock) provider
      // actually selected, and that provider reporting genuine
      // credentials configured. Anything missing is honestly reported as
      // Not Connected — never optimistic (spec §3/§30).
      const isReal = pmsEnabled && !demoMode && provider && provider.providerName !== 'mock';
      const configured = isReal && provider.isConfigured();
      const status = !pmsEnabled ? 'not_enabled' : demoMode ? 'demo' : configured ? 'connected' : provider && provider.providerName === 'mock' ? 'demo' : 'not_connected';

      const recentAudit = await pmsAuditLogRepository.listForPractice(practice.practiceId, { limit: 50 });
      const lastSuccessfulTest = recentAudit.find((a) => a.event === 'connection_test' && a.outcome === 'success') || null;

      res.json({
        pmsEnabled,
        demoMode,
        providerName: pmsEnabled ? (provider ? provider.providerName : null) : null,
        status, // 'not_enabled' | 'demo' | 'not_connected' | 'connected'
        statusMessage: !pmsEnabled
          ? 'Open Dental integration is not enabled for this practice.'
          : demoMode
          ? 'Demo Mode — Open Dental is not connected.'
          : configured
          ? 'Connected to Open Dental.'
          : 'Open Dental is enabled but not yet configured (missing credentials).',
        providerConfigured: isReal ? provider.isConfigured() : false,
        lastSuccessfulTestAt: lastSuccessfulTest ? lastSuccessfulTest.createdAt : null,
        mappings: {
          serviceMappingCount: mappingCount(practice.pms?.serviceMappings),
          providerMappingCount: mappingCount(practice.pms?.providerMappings),
          operatoryMappingCount: mappingCount(practice.pms?.operatoryMappings),
        },
      });
    } catch (error) {
      console.error('Admin PMS status fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch PMS status' });
    }
  });

  // POST /api/admin/pms/test-connection -> a safe, read-only connectivity check (spec §6). Never creates/modifies anything.
  router.post('/admin/pms/test-connection', async (req, res) => {
    try {
      const practice = req.practice;
      const provider = pmsProviders.getPMSProvider(practice);
      if (!provider) {
        return res.json({ success: false, provider: null, error: 'PMS_NOT_ENABLED' });
      }
      const result = await provider.testConnection(practice);
      await pmsAuditLogRepository.record(practice.practiceId, {
        event: 'connection_test',
        provider: provider.providerName,
        outcome: result.success ? 'success' : 'failure',
        failureReason: result.success ? null : result.error,
      });
      // Never return secrets — testConnection()'s own result never
      // includes them, but this is asserted explicitly at the boundary
      // too (spec §6/§21: "never return secrets").
      res.json({ success: result.success, provider: result.provider, latencyMs: result.latencyMs, apiVersion: result.apiVersion, error: result.error });
    } catch (error) {
      console.error('Admin PMS test-connection failed:', error.message);
      res.status(500).json({ error: 'Failed to test PMS connection' });
    }
  });

  // GET /api/admin/pms-settings -> the admin-editable subset (ID mappings only).
  router.get('/admin/pms-settings', async (req, res) => {
    try {
      const practice = await getPracticeResolved(req.practiceId);
      res.json({
        serviceMappings: practice.pms?.serviceMappings || {},
        providerMappings: practice.pms?.providerMappings || {},
        operatoryMappings: practice.pms?.operatoryMappings || {},
      });
    } catch (error) {
      console.error('Failed to load PMS settings:', error.message);
      res.status(500).json({ error: 'Failed to load PMS settings.' });
    }
  });

  // PUT /api/admin/pms-settings -> validate, sanitize, persist (scoped to req.practiceId ONLY; never accepts credentials — see validatePmsSettingsPatch).
  router.put('/admin/pms-settings', async (req, res) => {
    const { valid, sanitized, errors } = validatePmsSettingsPatch(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid PMS settings.', details: errors });
    }
    try {
      await practiceSettingsRepository.upsert(req.practiceId, { pms: sanitized }, req.admin.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save PMS settings:', error.message);
      res.status(500).json({ error: 'Failed to save PMS settings.' });
    }
  });

  return router;
}

module.exports = buildAdminPMSRouter();
module.exports.buildAdminPMSRouter = buildAdminPMSRouter;
