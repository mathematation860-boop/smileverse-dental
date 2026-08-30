/**
 * Google Calendar OAuth connect flow — an admin/setup action performed
 * once per practice by whoever runs it, NOT a patient-facing feature.
 * Deliberately has no UI (see the Phase 2 report: "do not redesign the
 * UI" was taken literally — connecting a calendar is a raw URL an admin
 * visits, same category of action as editing a practice's config file).
 *
 * Security note (documented honestly rather than pretended away): this
 * app has no admin login/session system at all. Without one, anything
 * reachable by URL is reachable by anyone who has the URL. The
 * OAuth-*start* endpoint is gated by a shared CALENDAR_ADMIN_SECRET env
 * var as a stopgap — good enough to stop a random visitor from
 * connecting an arbitrary Google account as "the practice's calendar",
 * but a real admin-auth system is the correct long-term fix and is
 * flagged as a production blocker in the Phase 2 report.
 */

const express = require('express');
const { getPractice } = require('../config/practiceRepository');
const googleOAuthClient = require('../services/calendar/googleOAuthClient');
const oauthStateStore = require('../services/calendar/oauthStateStore');
const calendarConnectionRepository = require('../repositories/CalendarConnectionRepository');

const router = express.Router();

function isAdminAuthorized(req) {
  const configured = process.env.CALENDAR_ADMIN_SECRET;
  if (!configured) return false; // never silently allow if it was never set
  const provided = req.query.adminSecret || req.headers['x-calendar-admin-secret'];
  return typeof provided === 'string' && provided.length > 0 && provided === configured;
}

// GET /api/calendar/status -> connection state only, never tokens.
router.get('/calendar/status', async (req, res) => {
  try {
    const connection = await calendarConnectionRepository.isConnected(req.practice.practiceId);
    res.json({
      demoMode: req.practice.demoMode,
      calendarProvider: req.practice.integrations?.calendarProvider || 'demo',
      connected: !!connection,
      connectedEmail: connection?.connectedEmail || null,
      calendarId: connection?.calendarId || null,
    });
  } catch (error) {
    console.error('Calendar status error:', error);
    res.status(500).json({ error: 'Failed to read calendar connection status' });
  }
});

// GET /api/calendar/oauth/start?adminSecret=...&practiceId=... -> redirects to Google's consent screen.
router.get('/calendar/oauth/start', (req, res) => {
  // Check authorization BEFORE revealing anything about server config —
  // an unauthenticated caller should not learn whether Google OAuth is
  // even configured on this server.
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: 'Missing or invalid adminSecret.' });
  }
  if (!googleOAuthClient.isConfigured()) {
    return res.status(501).json({ error: 'Google Calendar OAuth is not configured on this server yet.' });
  }

  const practice = req.practice; // resolved by practiceContext from X-Practice-Id / ?practiceId=
  const state = oauthStateStore.createState(practice.practiceId);
  const authUrl = googleOAuthClient.buildAuthUrl(state);
  res.redirect(authUrl);
});

// GET /api/calendar/oauth/callback?code=...&state=... -> Google redirects here after consent.
router.get('/calendar/oauth/callback', async (req, res) => {
  const { code, state, error: googleError } = req.query;
  const frontendUrl = process.env.FRONTEND_URL;

  function finish(ok, detail) {
    if (frontendUrl) {
      const url = `${frontendUrl}${frontendUrl.includes('?') ? '&' : '?'}calendar=${ok ? 'connected' : 'error'}`;
      return res.redirect(url);
    }
    return res.status(ok ? 200 : 400).send(ok ? 'Google Calendar connected. You can close this tab.' : `Google Calendar connection failed: ${detail}`);
  }

  if (googleError) {
    console.error('Google OAuth returned an error:', googleError);
    return finish(false, 'consent was not granted');
  }
  if (!code || !state) {
    return finish(false, 'missing code/state');
  }

  const practiceId = oauthStateStore.consumeState(state);
  if (!practiceId) {
    return finish(false, 'invalid or expired state');
  }

  const practice = getPractice(practiceId);
  if (!practice) {
    return finish(false, 'unknown practice');
  }

  try {
    const tokens = await googleOAuthClient.exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Google only issues a refresh_token on a fresh consent grant. We
      // always request prompt=consent so this should not happen, but if
      // it does, we must not silently proceed with an access-only
      // connection that will stop working in an hour.
      console.error(`OAuth callback for ${practiceId}: no refresh_token returned.`);
      return finish(false, 'Google did not return a refresh token — revoke this app\'s access in your Google Account and try connecting again');
    }

    const connectedEmail = await googleOAuthClient.fetchConnectedEmail(tokens.id_token).catch(() => null);

    await calendarConnectionRepository.upsert(practiceId, {
      provider: 'google',
      calendarId: 'primary',
      connectedEmail,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      scope: tokens.scope,
      connectedAt: new Date(),
    });

    return finish(true);
  } catch (error) {
    console.error('OAuth callback failed:', error.message);
    return finish(false, 'token exchange failed');
  }
});

// POST /api/calendar/disconnect -> removes the stored connection for this practice.
router.post('/calendar/disconnect', async (req, res) => {
  if (!isAdminAuthorized(req)) {
    return res.status(403).json({ error: 'Missing or invalid adminSecret.' });
  }
  try {
    await calendarConnectionRepository.remove(req.practice.practiceId);
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect calendar' });
  }
});

module.exports = router;
