/**
 * Brute-force protection for the patient-facing appointment lookup.
 *
 * A booking reference is only as strong as the number of guesses an
 * attacker gets. Without a limiter, the unauthenticated lookup endpoint
 * would let someone hold a phone number fixed and grind references at
 * request speed. Locking the phone number out after a handful of misses
 * turns that into a non-attack.
 *
 * Same shape and reasoning as services/auth/loginRateLimiter.js: keyed by
 * the identifier being attacked (here the phone number, there the email)
 * rather than by IP, in-memory because it only needs to survive minutes,
 * and with an injectable clock so tests don't need real timers. A process
 * restart clears it, which resets attempts — the safe direction to fail,
 * since the alternative is locking real patients out across a deploy.
 *
 * Known limitation, deliberately not solved here: an attacker who varies
 * the phone number on every request is not slowed down by a per-phone
 * limiter. That needs IP- or global-rate limiting at the edge, which is
 * infrastructure this app does not own. Recorded in the audit findings
 * rather than half-built.
 */

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

const attempts = new Map(); // key -> { count, lockedUntil }

function keyFor(practiceId, phone) {
  return `${practiceId}:${String(phone || '').replace(/[^0-9]/g, '')}`;
}

/** True if this practice+phone is currently locked out from looking anything up. */
function isLocked(practiceId, phone, nowFn = Date.now) {
  const entry = attempts.get(keyFor(practiceId, phone));
  if (!entry || !entry.lockedUntil) return false;
  return entry.lockedUntil > nowFn();
}

/** How many seconds until the lockout clears (0 if not locked). */
function lockoutRemainingSeconds(practiceId, phone, nowFn = Date.now) {
  const entry = attempts.get(keyFor(practiceId, phone));
  if (!entry || !entry.lockedUntil) return 0;
  return Math.max(0, Math.ceil((entry.lockedUntil - nowFn()) / 1000));
}

/** Records one failed lookup; locks out after MAX_ATTEMPTS. */
function recordFailure(practiceId, phone, nowFn = Date.now) {
  const key = keyFor(practiceId, phone);
  const entry = attempts.get(key) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = nowFn() + LOCKOUT_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

/** Clears failure history after a successful lookup. */
function recordSuccess(practiceId, phone) {
  attempts.delete(keyFor(practiceId, phone));
}

/** Test-only: drops all recorded attempts. */
function reset() {
  attempts.clear();
}

module.exports = {
  isLocked,
  lockoutRemainingSeconds,
  recordFailure,
  recordSuccess,
  reset,
  MAX_ATTEMPTS,
  LOCKOUT_MS,
};
