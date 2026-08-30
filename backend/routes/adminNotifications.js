/**
 * Admin Notifications settings/status page + Notification History (Phase 5
 * spec §17/§18/§19), mirroring routes/adminVoice.js's own structure and
 * honesty rules almost exactly:
 *
 * - Every stat comes from real NotificationLogRepository documents — an
 *   empty history reports 0s across the board, never sample/demo numbers.
 * - "live"/provider-configured status never claims more than
 *   `practice.demoMode === false` AND the selected provider's own
 *   `isConfigured()` genuinely reports true (spec §4/§30: never claim
 *   SMS/email is live unless a real provider has actually accepted a real
 *   message — this endpoint is careful to describe CONFIGURATION, not
 *   "delivery has been proven", which only notification history itself
 *   can show).
 * - Notification history is practice-scoped like every other admin
 *   resource here (spec §18: "Practice A must never see Practice B
 *   notification history") and never returns provider secrets/tokens
 *   (spec §20) — NotificationLog never stores those in the first place
 *   (see models/NotificationLog.js's header comment).
 *
 * `buildAdminNotificationsRouter(deps)` mirrors every other Phase 3/4
 * admin router's DI pattern — see tests/adminNotificationsRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const notificationLogRepositoryReal = require('../repositories/NotificationLogRepository');
const notificationProvidersReal = require('../services/notifications');
const practiceSettingsRepositoryReal = require('../repositories/PracticeSettingsRepository');
const { getPracticeResolved: getPracticeResolvedReal } = require('../config/practiceRepository');
const { validateNotificationSettingsPatch } = require('../services/practice/settingsValidation');
const { getReminderOffsetsHours } = require('../services/notifications/reminderScheduler');

function buildAdminNotificationsRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const notificationLogRepository = deps.notificationLogRepository || notificationLogRepositoryReal;
  const notificationProviders = deps.notificationProviders || notificationProvidersReal;
  const practiceSettingsRepository = deps.practiceSettingsRepository || practiceSettingsRepositoryReal;
  const getPracticeResolved = deps.getPracticeResolved || getPracticeResolvedReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/notifications -> status tile row + provider configuration summary.
  router.get('/admin/notifications', async (req, res) => {
    try {
      const practice = req.practice;
      const demoMode = practice.demoMode !== false;
      const smsProvider = notificationProviders.getSmsProvider(practice);
      const emailProvider = notificationProviders.getEmailProvider(practice);
      const summary = await notificationLogRepository.getSummary(practice.practiceId);

      res.json({
        demoMode,
        smsEnabled: practice.notifications?.smsEnabled !== false,
        emailEnabled: practice.notifications?.emailEnabled !== false,
        // "live" requires BOTH demoMode explicitly off AND that provider
        // reporting its own credentials present — never optimistic.
        smsLive: !demoMode && smsProvider.providerName !== 'mock' && smsProvider.isConfigured(),
        emailLive: !demoMode && emailProvider.providerName !== 'mock' && emailProvider.isConfigured(),
        smsProviderName: smsProvider.providerName,
        emailProviderName: emailProvider.providerName,
        smsProviderConfigured: smsProvider.isConfigured(),
        emailProviderConfigured: emailProvider.isConfigured(),
        reminderOffsetsHours: getReminderOffsetsHours(practice),
        emergencyAlertsAlwaysOn: true, // never a toggle — see services/notifications/notificationService.js's notifyEmergencyClinicAlert
        stats: {
          total: summary.total,
          sent: summary.sent,
          failed: summary.failed,
          simulated: summary.simulated,
          smsCount: summary.byChannel.sms,
          emailCount: summary.byChannel.email,
        },
      });
    } catch (error) {
      console.error('Admin notifications status fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch notification status' });
    }
  });

  // GET /api/admin/notification-history -> practice-scoped notification list, newest first.
  router.get('/admin/notification-history', async (req, res) => {
    try {
      const rows = await notificationLogRepository.listForPractice(req.practiceId, { limit: 200 });
      res.json(
        rows.map((r) => ({
          id: r._id,
          type: r.type,
          channel: r.channel,
          language: r.language,
          destinationMasked: r.destinationMasked,
          status: r.status,
          provider: r.provider,
          providerStatus: r.providerStatus,
          failureReason: r.failureReason,
          attempts: r.attempts,
          demoMode: r.demoMode,
          createdAt: r.createdAt,
          // Deliberately NOT included: providerMessageId (an internal
          // vendor identifier with no admin-facing use) and, obviously,
          // any credential/secret — those never even exist on this model
          // (spec §20: "no provider tokens returned to frontend").
        }))
      );
    } catch (error) {
      console.error('Admin notification history fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch notification history' });
    }
  });

  // GET /api/admin/notification-settings -> the admin-editable subset (spec §9/§19).
  router.get('/admin/notification-settings', async (req, res) => {
    try {
      const practice = await getPracticeResolved(req.practiceId);
      res.json({
        smsEnabled: practice.notifications?.smsEnabled !== false,
        emailEnabled: practice.notifications?.emailEnabled !== false,
        reminderOffsetsHours: getReminderOffsetsHours(practice),
      });
    } catch (error) {
      console.error('Failed to load notification settings:', error.message);
      res.status(500).json({ error: 'Failed to load notification settings.' });
    }
  });

  // PUT /api/admin/notification-settings -> validate, sanitize, persist (scoped to req.practiceId ONLY).
  router.put('/admin/notification-settings', async (req, res) => {
    const { valid, sanitized, errors } = validateNotificationSettingsPatch(req.body);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid notification settings.', details: errors });
    }
    try {
      await practiceSettingsRepository.upsert(req.practiceId, { notifications: sanitized }, req.admin.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save notification settings:', error.message);
      res.status(500).json({ error: 'Failed to save notification settings.' });
    }
  });

  return router;
}

module.exports = buildAdminNotificationsRouter();
module.exports.buildAdminNotificationsRouter = buildAdminNotificationsRouter;
