/**
 * Practice Settings + AI Configuration (Phase 3 §10-11).
 *
 * Every route here is mounted behind requireAuth (see server.js), so
 * req.practice/req.practiceId are already the authenticated admin's OWN
 * practice — see middleware/authMiddleware.js for why that's safe to
 * trust. A GET returns the resolved (base + saved overrides) practice
 * config, same shape the public receptionist sees; a PUT validates +
 * sanitizes the patch (services/practice/settingsValidation.js) before
 * ever persisting it (services/practice/practiceMerge.js is what applies
 * it going forward — this route never reimplements that logic).
 *
 * `buildAdminSettingsRouter(deps)` allows tests to inject fakes for the
 * repository/resolver — see tests/adminSettingsRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const practiceSettingsRepositoryReal = require('../repositories/PracticeSettingsRepository');
const { getPracticeResolved: getPracticeResolvedReal } = require('../config/practiceRepository');
const { validateSettingsPatch, validateAiConfigPatch } = require('../services/practice/settingsValidation');

function buildAdminSettingsRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const practiceSettingsRepository = deps.practiceSettingsRepository || practiceSettingsRepositoryReal;
  const getPracticeResolved = deps.getPracticeResolved || getPracticeResolvedReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/settings -> the full resolved practice config this admin can edit.
  router.get('/admin/settings', async (req, res) => {
    try {
      const practice = await getPracticeResolved(req.practiceId);
      res.json({
        demoMode: practice.demoMode,
        name: practice.name,
        tagline: practice.tagline,
        phone: practice.phone,
        email: practice.email,
        address: practice.address,
        website: practice.website,
        timezone: practice.timezone,
        hours: practice.hours,
        services: practice.services,
        insurance: practice.insurance,
        faqs: practice.faqs,
        policies: {
          cancellationSummary: practice.cancellationPolicy?.summary || '',
          emergencySummary: practice.emergencyPolicy?.summary || '',
        },
      });
    } catch (error) {
      console.error('Failed to load practice settings:', error.message);
      res.status(500).json({ error: 'Failed to load practice settings.' });
    }
  });

  // PUT /api/admin/settings -> validate, sanitize, persist (scoped to req.practiceId ONLY).
  router.put('/admin/settings', async (req, res) => {
    const { valid, sanitized, errors } = validateSettingsPatch(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid settings.', details: errors });
    }
    try {
      await practiceSettingsRepository.upsert(req.practiceId, sanitized, req.admin.id);
      const practice = await getPracticeResolved(req.practiceId);
      res.json({ success: true, name: practice.name }); // small ack, not the full doc — the frontend already has the values it just sent
    } catch (error) {
      console.error('Failed to save practice settings:', error.message);
      res.status(500).json({ error: 'Failed to save practice settings.' });
    }
  });

  // GET /api/admin/ai-config -> current practice-specific AI notes (never anything safety-related — see settingsValidation.js).
  router.get('/admin/ai-config', async (req, res) => {
    try {
      const practice = await getPracticeResolved(req.practiceId);
      res.json({ customInstructions: practice.aiConfig?.customInstructions || '' });
    } catch (error) {
      console.error('Failed to load AI configuration:', error.message);
      res.status(500).json({ error: 'Failed to load AI configuration.' });
    }
  });

  // PUT /api/admin/ai-config -> only ever writes `aiConfig.customInstructions`, nothing else.
  router.put('/admin/ai-config', async (req, res) => {
    const { valid, sanitized, errors } = validateAiConfigPatch(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid AI configuration.', details: errors });
    }
    try {
      await practiceSettingsRepository.upsert(req.practiceId, { aiConfig: sanitized }, req.admin.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save AI configuration:', error.message);
      res.status(500).json({ error: 'Failed to save AI configuration.' });
    }
  });

  return router;
}

module.exports = buildAdminSettingsRouter();
module.exports.buildAdminSettingsRouter = buildAdminSettingsRouter;
