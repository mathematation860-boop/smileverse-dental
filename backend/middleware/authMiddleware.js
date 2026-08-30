/**
 * Admin authentication + practice isolation enforcement (Phase 3).
 *
 * This is the ONE place that decides "is this admin request allowed, and
 * for which practice" — every admin route downstream trusts `req.admin`
 * and `req.practice`/`req.practiceId` set here, and nothing else.
 *
 * Practice isolation, concretely: the public-facing `practiceContext`
 * middleware (see middleware/practiceContext.js) resolves `req.practice`
 * from an `X-Practice-Id` header or `?practiceId=` query param, because
 * for the anonymous receptionist widget that's the only signal available
 * and it's not a trust boundary — a patient can only ever see/affect
 * their own conversation regardless of which practice they claim. Admin
 * routes are different: an admin's practiceId is a real authorization
 * boundary (Practice A's admin must never see Practice B's data), so it
 * can never come from anything the client sends per-request. Here it
 * comes ONLY from the signed session token, which was itself only ever
 * issued (see routes/adminAuth.js) from the practiceId stored on that
 * admin's own database row at login time. `requireAuth` OVERWRITES
 * whatever `practiceContext` set, so even a malicious header on an admin
 * request is simply ignored.
 *
 * `buildAuthMiddleware(deps)` exists so tests can inject fakes for the
 * token verifier / admin lookup / practice resolver, the same
 * dependency-injection pattern used by GoogleCalendarAppointmentProvider
 * (Phase 2) to test real orchestration logic without a live database.
 */

const sessionTokens = require('../services/auth/sessionTokens');
const adminUserRepository = require('../repositories/AdminUserRepository');
const { getPracticeResolved } = require('../config/practiceRepository');

const COOKIE_NAME = 'smileverse_admin_session';

function buildAuthMiddleware(deps = {}) {
  const verifyToken = deps.verifyToken || sessionTokens.verifyToken;
  const findByIdInPractice = deps.findByIdInPractice || adminUserRepository.findByIdInPractice;
  const resolvePractice = deps.resolvePractice || getPracticeResolved;

  /** Express middleware: 401s if not logged in, 403s if the account was disabled since the token was issued. */
  function requireAuth() {
    return async function (req, res, next) {
      try {
        const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
        const claims = verifyToken(token);
        if (!claims) {
          return res.status(401).json({ error: 'Not authenticated.' });
        }

        const adminDoc = await findByIdInPractice(claims.practiceId, claims.adminId);
        if (!adminDoc) {
          return res.status(401).json({ error: 'Not authenticated.' });
        }
        if (!adminDoc.active) {
          return res.status(403).json({ error: 'This account has been disabled. Contact your practice administrator.' });
        }

        const practice = await resolvePractice(adminDoc.practiceId);
        if (!practice) {
          console.error(`Admin ${adminDoc._id} references unknown practiceId "${adminDoc.practiceId}"`);
          return res.status(500).json({ error: 'Practice configuration error.' });
        }

        req.admin = {
          id: String(adminDoc._id),
          practiceId: adminDoc.practiceId,
          role: adminDoc.role,
          name: adminDoc.name,
          email: adminDoc.email,
        };
        // Practice isolation boundary — see file header. Never trust
        // anything set on req.practice/req.practiceId before this point.
        req.practiceId = practice.practiceId;
        req.practice = practice;
        next();
      } catch (err) {
        console.error('Admin auth check failed:', err.message);
        res.status(500).json({ error: 'Authentication check failed.' });
      }
    };
  }

  /** Express middleware factory: 403s unless req.admin.role is one of `roles`. Must run after requireAuth(). */
  function requireRole(...roles) {
    return function (req, res, next) {
      if (!req.admin || !roles.includes(req.admin.role)) {
        return res.status(403).json({ error: 'You do not have permission to perform this action.' });
      }
      next();
    };
  }

  return { requireAuth, requireRole };
}

module.exports = { ...buildAuthMiddleware(), buildAuthMiddleware, COOKIE_NAME };
