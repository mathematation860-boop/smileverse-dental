/**
 * A fake requireAuth() middleware for route tests — simulates "already
 * logged in as this admin" without a real JWT or database, the same way
 * tests/authMiddleware.test.js fakes verifyToken/findByIdInPractice
 * directly. Route tests pass this in as `deps.requireAuthMiddleware` to
 * the various `buildXRouter(deps)` factories.
 *
 * Reads `req.testAdmin` (set by the test itself) rather than a header —
 * simpler than round-tripping a fake bearer token through a fake req.
 */

const PRACTICES = {
  'practice-a': { practiceId: 'practice-a', name: 'Clinic A', demoMode: true, timezone: 'America/New_York', integrations: { calendarProvider: 'demo' } },
  'practice-b': { practiceId: 'practice-b', name: 'Clinic B', demoMode: true, timezone: 'America/New_York', integrations: { calendarProvider: 'demo' } },
};

function fakeAuthMiddleware(req, res, next) {
  if (!req.testAdmin) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }
  req.admin = req.testAdmin;
  req.practiceId = req.testAdmin.practiceId;
  req.practice = PRACTICES[req.testAdmin.practiceId];
  next();
}

const ADMIN_A = { id: 'admin-a1', practiceId: 'practice-a', role: 'practice_admin', name: 'Alice', email: 'alice@a.com' };
const ADMIN_B = { id: 'admin-b1', practiceId: 'practice-b', role: 'practice_admin', name: 'Bob', email: 'bob@b.com' };

module.exports = { fakeAuthMiddleware, PRACTICES, ADMIN_A, ADMIN_B };
