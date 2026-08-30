/**
 * Admin Voice settings/status page + Call History (Phase 4 spec §19/§20).
 *
 * Every field here is either read straight off the practice's own static
 * config (never admin-editable — see services/practice/practiceMerge.js)
 * or aggregated from real CallLog documents (repositories/CallLogRepository.js)
 * — an empty call history reports 0s across the board, never sample/demo
 * numbers. `enabled`/`provider status` never claims "live" unless the
 * practice genuinely has `demoMode: false` AND a configured phone number
 * AND the selected provider reports itself configured (spec §3/§24: never
 * claim voice AI is live when it isn't).
 *
 * `buildAdminVoiceRouter(deps)` mirrors every other Phase 3 admin router's
 * DI pattern — see tests/adminVoiceRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const callLogRepositoryReal = require('../repositories/CallLogRepository');
const voiceProvidersReal = require('../services/voice');

function buildAdminVoiceRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const callLogRepository = deps.callLogRepository || callLogRepositoryReal;
  const voiceProviders = deps.voiceProviders || voiceProvidersReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/voice -> status tile row + config summary.
  router.get('/admin/voice', async (req, res) => {
    try {
      const practice = req.practice;
      const provider = voiceProviders.getTelephonyProvider(practice);
      const demoMode = practice.demoMode !== false;
      const phoneNumber = practice.voice?.phoneNumber || null;

      // "Live" requires ALL of: demoMode explicitly off, a real provider
      // actually selected (not silently falling back to mock), a phone
      // number configured, and that provider reporting its own
      // credentials present. Any one of those missing means this is
      // honestly reported as not live — never optimistically "on".
      const enabled = !demoMode && provider.providerName !== 'mock' && !!phoneNumber && provider.isConfigured();

      const summary = await callLogRepository.getSummary(practice.practiceId);

      res.json({
        enabled,
        demoMode,
        providerName: provider.providerName,
        providerConfigured: provider.isConfigured(),
        phoneNumber,
        emergencySafetyAlwaysOn: true, // never a toggle — the deterministic emergency check cannot be disabled by any admin setting (spec §19)
        stats: {
          totalCalls: summary.total,
          answeredCalls: summary.answered,
          transferredCalls: summary.transferred,
          missedCalls: summary.missed,
          appointmentConversions: summary.appointmentConversions,
          avgDurationSeconds: summary.avgDurationSeconds,
        },
      });
    } catch (error) {
      console.error('Admin voice status fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch voice status' });
    }
  });

  // GET /api/admin/call-history -> practice-scoped call list, newest first.
  router.get('/admin/call-history', async (req, res) => {
    try {
      const calls = await callLogRepository.listForPractice(req.practiceId, { limit: 200 });
      res.json(
        calls.map((c) => ({
          id: c._id,
          callSid: c.callSid,
          fromNumber: c.fromNumber,
          status: c.status,
          outcome: c.outcome,
          appointmentCreated: c.appointmentCreated,
          handoffRequested: c.handoffRequested,
          emergencyDetected: c.emergencyDetected,
          turnCount: c.turnCount,
          demoMode: c.demoMode,
          startedAt: c.startedAt,
          endedAt: c.endedAt,
          durationSeconds: c.durationSeconds,
        }))
      );
    } catch (error) {
      console.error('Admin call history fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch call history' });
    }
  });

  return router;
}

module.exports = buildAdminVoiceRouter();
module.exports.buildAdminVoiceRouter = buildAdminVoiceRouter;
