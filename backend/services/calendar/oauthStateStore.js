/**
 * Short-lived CSRF-protection store for the Google OAuth connect flow.
 *
 * This app has no admin login/session system (see routes/calendarAuth.js
 * for the CALENDAR_ADMIN_SECRET stopgap that covers the bigger gap that
 * creates), so the OAuth `state` parameter can't ride on an existing
 * session — it gets its own single-use, short-lived nonce instead:
 * /oauth/start mints one tied to the practiceId that requested it,
 * /oauth/callback must present that exact nonce back and can only use it
 * once. This blocks a forged callback request from connecting a random
 * Google account to a practiceId the attacker guessed.
 *
 * In-memory Map, same pattern as services/conversationStore.js — fine for
 * a flow that's supposed to complete within a couple of minutes of being
 * started; a restart mid-flow just means the admin starts over.
 */

const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the Google consent screen
const nonces = new Map(); // nonce -> { practiceId, expiresAt }

function createState(practiceId) {
  const nonce = crypto.randomBytes(24).toString('hex');
  nonces.set(nonce, { practiceId, expiresAt: Date.now() + TTL_MS });
  return nonce;
}

/** Consumes (single-use) the nonce and returns the practiceId it was minted for, or null if invalid/expired/already used. */
function consumeState(nonce) {
  const entry = nonces.get(nonce);
  nonces.delete(nonce); // single-use regardless of outcome
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.practiceId;
}

module.exports = { createState, consumeState };
