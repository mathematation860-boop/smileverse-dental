/**
 * The actual login DECISION logic, extracted out of routes/adminAuth.js
 * so it can be unit-tested with injected fakes — same
 * dependency-injection pattern as GoogleCalendarAppointmentProvider
 * (Phase 2) and middleware/authMiddleware.js's buildAuthMiddleware.
 * routes/adminAuth.js is a thin wrapper that only translates this
 * function's `outcome` into an HTTP status/cookie.
 *
 * Returns one of:
 *   { outcome: 'locked', retryAfterSeconds }
 *   { outcome: 'invalid_credentials' }
 *   { outcome: 'disabled' }
 *   { outcome: 'success', admin: {...}, token }
 * Never throws for an ordinary bad-login case — only for a genuine
 * infrastructure failure (DB unreachable), which routes/adminAuth.js
 * maps to a 500.
 */

const adminUserRepository = require('../../repositories/AdminUserRepository');
const { verifyPassword } = require('./passwordHashing');
const sessionTokens = require('./sessionTokens');
const loginRateLimiter = require('./loginRateLimiter');

async function attemptLogin({ practiceId, email, password }, deps = {}) {
  const findByEmailForLogin = deps.findByEmailForLogin || adminUserRepository.findByEmailForLogin;
  const verify = deps.verifyPassword || verifyPassword;
  const issueToken = deps.issueToken || sessionTokens.issueToken;
  const markLoginSuccessful = deps.markLoginSuccessful || adminUserRepository.markLoginSuccessful;
  const rateLimiter = deps.rateLimiter || loginRateLimiter;

  if (rateLimiter.isLocked(practiceId, email)) {
    return { outcome: 'locked', retryAfterSeconds: rateLimiter.lockoutRemainingSeconds(practiceId, email) };
  }

  const admin = await findByEmailForLogin(practiceId, email);
  if (!admin) {
    rateLimiter.recordFailure(practiceId, email);
    return { outcome: 'invalid_credentials' };
  }
  if (!admin.active) {
    // Not rate-limited the same way as a wrong password — see routes/adminAuth.js.
    return { outcome: 'disabled' };
  }

  const validPassword = await verify(password, admin.passwordHash);
  if (!validPassword) {
    rateLimiter.recordFailure(practiceId, email);
    return { outcome: 'invalid_credentials' };
  }

  rateLimiter.recordSuccess(practiceId, email);
  await markLoginSuccessful(admin._id);

  const safeAdmin = { id: String(admin._id), name: admin.name, email: admin.email, role: admin.role, practiceId: admin.practiceId };
  const token = issueToken({ adminId: safeAdmin.id, practiceId: safeAdmin.practiceId, role: safeAdmin.role });
  return { outcome: 'success', admin: safeAdmin, token };
}

module.exports = { attemptLogin };
