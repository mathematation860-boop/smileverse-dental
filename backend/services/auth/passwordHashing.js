/**
 * Password hashing — the ONLY file that touches bcrypt directly, so there
 * is exactly one place that decides the hashing algorithm/cost, matching
 * the project's existing pattern of a single seam per external concern
 * (see googleOAuthClient.js for GOOGLE_CLIENT_SECRET, the same idea here
 * for admin passwords).
 *
 * Uses `bcryptjs` — a pure-JS implementation, deliberately NOT the native
 * `bcrypt` package, which needs a compiled binary per platform. That
 * matters here for the same reason the Phase 2 `googleapis` incident
 * mattered: a native-addon dependency is a build-time risk on a
 * constrained host like Railway. bcryptjs is slower per-hash than native
 * bcrypt, but login is a low-frequency, human-paced operation — the
 * tradeoff is clearly worth the deploy safety.
 */

const bcrypt = require('bcryptjs');

// 12 rounds is the current common baseline for interactive login (OWASP
// recommends >=10; 12 costs roughly 200-300ms per hash on typical server
// hardware, imperceptible for a human logging in, expensive enough to
// resist offline brute-forcing of a leaked hash).
const SALT_ROUNDS = 12;

/** Hashes a plaintext password. Never store the plaintext anywhere, ever. */
async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length < 8) {
    throw new Error('Password must be a string of at least 8 characters.');
  }
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** Verifies a plaintext password against a stored hash. Never throws on a bad guess — just returns false. */
async function verifyPassword(plainPassword, storedHash) {
  if (!plainPassword || !storedHash) return false;
  try {
    return await bcrypt.compare(plainPassword, storedHash);
  } catch (err) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword, SALT_ROUNDS };
