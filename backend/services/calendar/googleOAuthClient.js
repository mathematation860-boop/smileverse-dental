/**
 * Google OAuth 2.0 client construction — the ONLY file that touches
 * GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET directly. Everything else
 * (routes, the calendar provider) goes through the functions here, so
 * there is exactly one place that ever sees the client secret, and it
 * never leaves the server (see README/.env.example "Security").
 *
 * Uses `google-auth-library` directly rather than the monolithic
 * `googleapis` package — `google.auth.OAuth2` from `googleapis` IS this
 * same library's `OAuth2Client` re-exported, so the behavior is
 * identical, but `google-auth-library` alone is a few hundred KB instead
 * of `googleapis`'s 200+ MB of bundled clients for every Google API this
 * app doesn't use. (A first deploy of this feature with the full
 * `googleapis` package crashed the production Railway instance — fixed
 * same day by switching to this + `@googleapis/calendar`, see
 * googleCalendarClient.js.)
 *
 * Scope: a single broad `calendar` scope rather than several narrow ones.
 * Google does offer narrower scopes (calendar.events, calendar.freebusy),
 * but this integration needs event create/update/delete AND freebusy
 * reads for the SAME calendar, and splitting that across two scopes only
 * adds a second consent-screen line with no real security benefit for a
 * single connected calendar per practice — worth revisiting if this ever
 * needs to be scoped down for a security review. `openid` + `email` are
 * added so the token exchange also returns an ID token we can read the
 * connected account's email from (see fetchConnectedEmail) without a
 * second API call/package.
 */

const { OAuth2Client } = require('google-auth-library');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
];

function getRedirectUri() {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI || `http://localhost:${process.env.PORT || 5000}/api/calendar/oauth/callback`
  );
}

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function newOAuth2Client() {
  if (!isConfigured()) {
    throw new Error(
      'Google Calendar OAuth is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see .env.example).'
    );
  }
  return new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, getRedirectUri());
}

/** The URL to send a practice admin to in order to grant calendar access. `state` round-trips practiceId + a CSRF nonce. */
function buildAuthUrl(state) {
  const client = newOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // force a refresh_token even on a re-connect
    scope: SCOPES,
    state,
  });
}

/** Exchanges a one-time OAuth `code` for real tokens. Throws on any failure — never returns a partial/fake token set. */
async function exchangeCodeForTokens(code) {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens; // { access_token, refresh_token, expiry_date, scope, token_type, id_token }
}

/** The email of the Google account that just authorized us, read from the ID token — used only for a human-readable "connected as ..." status, never for auth decisions. */
async function fetchConnectedEmail(idToken) {
  if (!idToken) return null;
  try {
    const client = newOAuth2Client();
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    return ticket.getPayload()?.email || null;
  } catch (err) {
    console.error('fetchConnectedEmail: could not verify/read ID token:', err.message);
    return null;
  }
}

/**
 * Builds an OAuth2 client authorized for one practice's stored connection.
 * `onTokenRefreshed(tokens)` is called whenever the underlying library
 * silently mints a new access token from the refresh token, so the caller
 * can persist it — otherwise every call would re-hit Google's token
 * endpoint instead of reusing a still-valid cached access token.
 */
function buildAuthorizedClient(connection, onTokenRefreshed) {
  const client = newOAuth2Client();
  client.setCredentials({
    refresh_token: connection.refreshToken,
    access_token: connection.accessToken || undefined,
    expiry_date: connection.accessTokenExpiry ? new Date(connection.accessTokenExpiry).getTime() : undefined,
  });
  if (typeof onTokenRefreshed === 'function') {
    client.on('tokens', (tokens) => onTokenRefreshed(tokens));
  }
  return client;
}

module.exports = {
  SCOPES,
  isConfigured,
  getRedirectUri,
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchConnectedEmail,
  buildAuthorizedClient,
};
