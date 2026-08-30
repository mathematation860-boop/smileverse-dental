/**
 * Admin session tokens — a signed, stateless JWT carried in an httpOnly
 * cookie (see routes/adminAuth.js for where the cookie is set/cleared).
 *
 * Why a cookie instead of a bearer token the frontend stores itself:
 * anything readable by frontend JS (localStorage, a JS variable) is
 * readable by an XSS payload too. An httpOnly cookie can't be read by
 * page JS at all, which is the right default for a session that grants
 * access to real patient data. The tradeoff is CSRF, handled by setting
 * `sameSite: 'lax'` on the cookie (see adminAuth.js) plus every
 * state-changing admin route living only under same-origin fetch from
 * the dashboard SPA — see the Phase 3 report's Security section for the
 * full reasoning, matching how googleOAuthClient.js/oauthStateStore.js
 * each document their one security tradeoff inline.
 *
 * The token payload is intentionally minimal (adminId, practiceId, role)
 * — enough for authMiddleware to enforce practice isolation WITHOUT a
 * database round-trip on every request, while still re-checking
 * `active`/existence against the database on sensitive operations (see
 * authMiddleware.js). practiceId lives in the token because it is set
 * once at login from the admin's own database record and can never be
 * supplied or influenced by the client afterward — this is what makes it
 * trustworthy where a header or query param would not be.
 */

const jwt = require('jsonwebtoken');

const DEFAULT_EXPIRY = '12h';

function getSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      'ADMIN_JWT_SECRET is not configured (or is too short) — set a random 32+ character value (see .env.example). Admin auth cannot run without it.'
    );
  }
  return secret;
}

function isConfigured() {
  return Boolean(process.env.ADMIN_JWT_SECRET && process.env.ADMIN_JWT_SECRET.length >= 16);
}

/** Mints a signed session token for one admin. */
function issueToken({ adminId, practiceId, role }) {
  return jwt.sign({ adminId, practiceId, role }, getSecret(), { expiresIn: DEFAULT_EXPIRY });
}

/** Verifies + decodes a session token. Returns null (never throws) on any invalid/expired/tampered token. */
function verifyToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret());
    if (!payload || !payload.adminId || !payload.practiceId) return null;
    return { adminId: payload.adminId, practiceId: payload.practiceId, role: payload.role };
  } catch (err) {
    return null;
  }
}

module.exports = { issueToken, verifyToken, isConfigured, DEFAULT_EXPIRY };
