/**
 * Google Calendar OAuth connect flow.
 *
 * Phase 3 update: the dashboard's Calendar page (§4/§12) now uses
 * routes/adminCalendarAuth.js instead of this file's "start"/"status"/
 * "disconnect" routes — that version is gated by real admin session auth
 * (middleware/authMiddleware.js) rather than the CALENDAR_ADMIN_SECRET
 * shared secret below, and resolves practiceId from the authenticated
 * admin rather than a header, closing the isolation gap a shared secret
 * inherently has (anyone with the secret could act on ANY practiceId a
 * header claimed). The routes below are kept, unmodified, as a
 * documented fallback for non-interactive/ops use only — e.g.
 * connecting a calendar via a direct URL before any admin account has
 * been created yet for a freshly-added practice. New integrations
 * should use the admin-session routes.
 *
 * The OAuth *callback* below is still the ONE shared endpoint for BOTH
 * flows — Google always redirects here, and it recovers the practiceId
 * safely from the signed, single-use `state` nonce (see
 * services/calendar/oauthStateStore.js), never from anything the client
 * sends at callback time. Nothing about the callback changed.
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
