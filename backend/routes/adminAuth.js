/**
 * Admin login/logout/session-check — the Phase 3 replacement for the
 * temporary CALENDAR_ADMIN_SECRET stopgap (see routes/calendarAuth.js's
 * header comment on that stopgap, and adminCalendarAuth.js for how
 * calendar admin actions now use THIS session instead).
 *
 * Which practice an admin logs into: this app is single-tenant in
 * deployment today (one frontend, one practiceId resolved by
 * middleware/practiceContext.js from an X-Practice-Id header/default —
 * see that file), so login reuses the exact same resolution for "which
 * practice's admin table do I check this email against". This is safe
 * pre-auth because it only SCOPES the lookup, never grants anything by
 * itself — a correct password for the wrong practice's admin still won't
 * match any row. A future multi-practice SaaS login page would resolve
 * the practice from a subdomain/slug in the URL instead; noted as a
 * forward-looking limitation in the Phase 3 report, not solved here.
 *
 * The actual login decision (rate limit / invalid / disabled / success)
 * lives in services/auth/loginService.js so it's unit-testable with
 * injected fakes — this file only translates that outcome into HTTP.
 */

const express = require('express');
const { enforceMaxLengths } = require('../middleware/validate');
const { requireAuth, COOKIE_NAME } = require('../middleware/authMiddleware');
const loginService = require('../services/auth/loginService');
const sessionTokens = require('../services/auth/sessionTokens');

function cookieOptions() {
  // Frontend (Vercel) and backend (Railway) are deployed on different
  // domains, which makes every dashboard API call a cross-site request.
  // A `sameSite: 'lax'` cookie is never sent on cross-site fetch/XHR (only
  // on top-level navigations), so the browser silently drops it on every
  // /api/admin/* call after login — the login itself sets the cookie fine,
  // but the very next request came back "Not authenticated." That's this
  // exact bug. `SameSite: 'none'` is required for a cross-site cookie to be
  // sent at all, and browsers require `Secure` (HTTPS) whenever
  // SameSite=None is used — which is exactly what production already is
  // (Railway/Vercel are both HTTPS). In local dev (http://localhost),
  // Secure cookies aren't sent over plain HTTP, so we keep `lax` there,
  // where frontend and backend are effectively same-site anyway.
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 12 * 60 * 60 * 1000, // matches sessionTokens.DEFAULT_EXPIRY (12h)
    path: '/',
  };
}

/** Builds the router. `deps.attemptLogin` is overridable for tests (see tests/adminAuth.test.js) — everything else defaults to the real implementation. */
function buildAdminAuthRouter(deps = {}) {
  const attemptLogin = deps.attemptLogin || loginService.attemptLogin;
  const isSessionConfigured = deps.isConfigured || sessionTokens.isConfigured;
  // Overridable so tests can inject a fake "already authenticated" middleware
  // for /admin/me without needing a real database — see tests/adminAuth.test.js.
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();

  const router = express.Router();

  // POST /api/admin/login -> { email, password }
  router.post('/admin/login', enforceMaxLengths(['email']), async (req, res) => {
    try {
      if (!isSessionConfigured()) {
        console.error('Admin login attempted but ADMIN_JWT_SECRET is not configured.');
        return res.status(500).json({ error: 'Admin authentication is not configured on this server yet.' });
      }

      const { email, password } = req.body || {};
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const result = await attemptLogin({ practiceId: req.practiceId, email, password });

      switch (result.outcome) {
        case 'locked':
          return res.status(429).json({
            error: `Too many failed login attempts. Try again in ${Math.ceil(result.retryAfterSeconds / 60)} minute(s).`,
          });
        case 'disabled':
          return res.status(403).json({ error: 'This account has been disabled. Contact your practice administrator.' });
        case 'invalid_credentials':
          // Same generic message whether the email doesn't exist or the
          // password is wrong — never confirm/deny that an email is registered.
          return res.status(401).json({ error: 'Invalid email or password.' });
        case 'success':
          res.cookie(COOKIE_NAME, result.token, cookieOptions());
          return res.json({ success: true, admin: result.admin });
        default:
          throw new Error(`Unknown login outcome: ${result.outcome}`);
      }
    } catch (error) {
      console.error('Admin login failed:', error.message);
      res.status(500).json({ error: 'Login failed due to a server error. Please try again.' });
    }
  });

  // POST /api/admin/logout -> always succeeds; clearing an already-invalid cookie is harmless.
  router.post('/admin/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
    res.json({ success: true });
  });

  // GET /api/admin/me -> the logged-in admin's own safe profile (no password hash, ever).
  router.get('/admin/me', requireAuthMiddleware, (req, res) => {
    res.json({ admin: req.admin });
  });

  return router;
}

module.exports = buildAdminAuthRouter();
module.exports.buildAdminAuthRouter = buildAdminAuthRouter;
