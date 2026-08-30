/**
 * Login brute-force protection — in-memory, same pattern as
 * oauthStateStore.js (a Map is fine for a limiter that only needs to
 * survive minutes, and a restart clearing it just means attempts reset,
 * which is the safe direction to fail in).
 *
 * Keyed by `${practiceId}:${email}` rather than by IP: a shared office
 * network or a proxy/VPN means many legitimate admins can share one IP,
 * but a single email is exactly one account being attacked. (A future
 * phase could add IP-based limiting too for distributed guessing across
 * many emails — noted as a limitation in the Phase 3 report, not solved
 * here per "do not overengineer".)
 *
 * Pure logic with an injectable clock, so tests don't need real timers
 * (`nowFn` defaults to `Date.now`, a test can pass a fake one) — same
 * testability goal as the rest of this codebase's pure modules.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map(); // key -> { count, lockedUntil }

function keyFor(practiceId, email) {
  return `${practiceId}:${String(email || '').toLowerCase()}`;
}

/** True if this practice+email is currently locked out from attempting login. */
function isLocked(practiceId, email, nowFn = Date.now) {
  const entry = attempts.get(keyFor(practiceId, email));
  if (!entry || !entry.lockedUntil) return false;
  return entry.lockedUntil > nowFn();
}

/** How many seconds until the lockout clears (0 if not locked). */
function lockoutRemainingSeconds(practiceId, email, nowFn = Date.now) {
  const entry = attempts.get(keyFor(practiceId, email));
  if (!entry || !entry.lockedUntil) return 0;
  return Math.max(0, Math.ceil((entry.lockedUntil - nowFn()) / 1000));
}

/** Records one failed login attempt; locks out after MAX_ATTEMPTS. */
function recordFailure(practiceId, email, nowFn = Date.now) {
  const key = keyFor(practiceId, email);
  const entry = attempts.get(key) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = nowFn() + LOCKOUT_MS;
    entry.count = 0; // lockout window itself is the penalty; count resets once armed
  }
  attempts.set(key, entry);
}

/** Clears any failure history on a successful login. */
function recordSuccess(practiceId, email) {
  attempts.delete(keyFor(practiceId, email));
}

module.exports = { isLocked, lockoutRemainingSeconds, recordFailure, recordSuccess, MAX_ATTEMPTS, LOCKOUT_MS };
