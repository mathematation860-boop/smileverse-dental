/**
 * Admin-session-authenticated Google Calendar connect/disconnect
 * (Phase 3 §4). This is the route the dashboard's Calendar page actually
 * uses — it replaces the CALENDAR_ADMIN_SECRET shared-secret gate for
 * normal admin usage with the same session auth as every other admin
 * route (see middleware/authMiddleware.js).
 *
 * The OAuth *callback* stays the ONE shared route in routes/calendarAuth.js
 * — Google redirects there regardless of which flow started the consent
 * screen, and it already recovers the practiceId safely from the signed,
 * single-use `state` nonce (services/calendar/oauthStateStore.js), not
 * from anything the client sends at callback time. Only the *start*
 * step needs a session-authenticated twin, because that's the step that
 * decides which practice's calendar is about to be connected — and here
 * that decision comes from req.practiceId (the authenticated admin's own
 * practice), never a header or query param.
 *
 * routes/calendarAuth.js's original CALENDAR_ADMIN_SECRET-gated routes
 * are left in place, unmodified, as a documented fallback for
 * non-interactive/ops use (e.g. scripting a connection before any admin
 * account exists) — see that file's header comment, updated to point
 * here as the normal path.
 *
 * `buildAdminCalendarAuthRouter(deps)` allows tests to inject fakes —
 * see tests/adminCalendarAuthRoutes.test.js, including the practice-
 * isolation test that proves an admin can only ever read/disconnect
 * THEIR OWN practice's calendar connection.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const googleOAuthClientReal = require('../services/calendar/googleOAuthClient');
const oauthStateStoreReal = require('../services/calendar/oauthStateStore');
const calendarConnectionRepositoryReal = require('../repositories/CalendarConnectionRepository');

function buildAdminCalendarAuthRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const googleOAuthClient = deps.googleOAuthClient || googleOAuthClientReal;
  const oauthStateStore = deps.oauthStateStore || oauthStateStoreReal;
  const calendarConnectionRepository = deps.calendarConnectionRepository || calendarConnectionRepositoryReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/calendar/status -> connection state only, never tokens.
  router.get('/admin/calendar/status', async (req, res) => {
    try {
      const connection = await calendarConnectionRepository.isConnected(req.practiceId);
      res.json({
        demoMode: req.practice.demoMode,
        calendarProvider: req.practice.integrations?.calendarProvider || 'demo',
        connected: !!connection,
        connectedEmail: connection?.connectedEmail || null,
        calendarId: connection?.calendarId || null,
      });
    } catch (error) {
      console.error('Admin calendar status error:', error.message);
      res.status(500).json({ error: 'Failed to read calendar connection status' });
    }
  });

  // GET /api/admin/calendar/oauth/start -> redirects to Google's consent screen for THIS admin's own practice.
  router.get('/admin/calendar/oauth/start', (req, res) => {
    if (!googleOAuthClient.isConfigured()) {
      return res.status(501).json({ error: 'Google Calendar OAuth is not configured on this server yet.' });
    }
    const state = oauthStateStore.createState(req.practiceId);
    const authUrl = googleOAuthClient.buildAuthUrl(state);
    res.redirect(authUrl);
  });

  // POST /api/admin/calendar/disconnect -> removes the connection for THIS admin's own practice only.
  router.post('/admin/calendar/disconnect', async (req, res) => {
    try {
      await calendarConnectionRepository.remove(req.practiceId);
      res.json({ success: true });
    } catch (error) {
      console.error('Admin calendar disconnect error:', error.message);
      res.status(500).json({ error: 'Failed to disconnect calendar' });
    }
  });

  return router;
}

module.exports = buildAdminCalendarAuthRouter();
module.exports.buildAdminCalendarAuthRouter = buildAdminCalendarAuthRouter;
