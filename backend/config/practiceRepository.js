/**
 * Practice registry — the multi-tenancy seam.
 *
 * Every practice this product serves is one file under ./practices/,
 * keyed by its own `practiceId`. Adding a second dental clinic later is
 * "add a new file here", not "change routes/services/models" — every
 * other layer of the app asks THIS module for a practice object and
 * never imports a specific clinic's config directly.
 *
 * This is intentionally an in-memory map today (matching the project's
 * "don't build a database you don't need yet" instruction). Swapping it
 * for a real Practices collection/table later means rewriting the two
 * functions below — nothing else in the app needs to change, since every
 * caller already goes through getPractice()/getDefaultPracticeId().
 */

const practices = {
  'smileverse-dental': require('./practices/smileverse-dental'),
};

const DEFAULT_PRACTICE_ID = process.env.DEFAULT_PRACTICE_ID || 'smileverse-dental';

function getPractice(practiceId) {
  if (!practiceId) return null;
  return practices[practiceId] || null;
}

function getDefaultPracticeId() {
  return DEFAULT_PRACTICE_ID;
}

function listPracticeIds() {
  return Object.keys(practices);
}

/** Strips everything but digits, so '+1 (555) 000-1111', '1-555-000-1111', and '+15550001111' all compare equal regardless of how either side happened to format the leading '+'/country code punctuation. */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  return String(phoneNumber).replace(/\D/g, '');
}

/**
 * Resolves which practice owns an incoming phone number — the ONLY safe
 * way to identify a practice for a telephony webhook (Phase 4 spec §5:
 * "never trust caller-supplied practiceId"). A phone call has no header
 * a caller could forge the way an HTTP request could send a fake
 * `X-Practice-Id`; the only thing to trust is which of THIS deployment's
 * own numbers was actually dialed, which Twilio reports in the signed
 * webhook body's "To" field (see middleware/voicePracticeContext.js).
 *
 * Deliberately reads each practice's static base config only (`voice` and
 * `notifications.smsPhoneNumber` are both fields practiceMerge.js always
 * takes from the base config, never an admin override — see that file's
 * header comment), so this never needs a database round-trip and can
 * never be redirected by a practice admin's own dashboard settings.
 *
 * Matches against EITHER `voice.phoneNumber` (Phase 4, incoming calls) OR
 * `notifications.smsPhoneNumber` (Phase 5, incoming texts) — a real
 * deployment can point both a phone call and an SMS webhook at the very
 * same Twilio number, so this is the one shared lookup both
 * middleware/voicePracticeContext.js and middleware/smsPracticeContext.js
 * use, rather than two near-duplicate implementations.
 *
 * Returns null if no configured practice's number matches — the caller
 * must treat that as "reject this request", never fall back to a default
 * practice, since guessing would mean one practice's caller could end up
 * talking to a different practice's receptionist.
 */
function getPracticeIdForPhoneNumber(phoneNumber) {
  const target = normalizePhoneNumber(phoneNumber);
  if (!target) return null;
  for (const practiceId of listPracticeIds()) {
    const candidates = [practices[practiceId]?.voice?.phoneNumber, practices[practiceId]?.notifications?.smsPhoneNumber];
    if (candidates.some((configured) => configured && normalizePhoneNumber(configured) === target)) {
      return practiceId;
    }
  }
  return null;
}

/**
 * Phase 3: the static base config above, merged with whatever a practice
 * admin has saved via the dashboard (models/PracticeSettings.js). This is
 * the ONLY function that should be used to resolve "the practice" for any
 * request from here on (see middleware/practiceContext.js and
 * middleware/authMiddleware.js) — getPractice() above still exists
 * because scripts/tests that only need the static seed (e.g. "does this
 * practiceId exist at all") shouldn't need a database connection for that.
 *
 * Required to degrade gracefully: if the settings lookup fails (DB down,
 * not yet connected), this falls back to the static base config rather
 * than failing the request — same "never let an optional layer break a
 * request that would otherwise succeed" rule as AnalyticsRepository.
 */
async function getPracticeResolved(practiceId) {
  const base = getPractice(practiceId);
  if (!base) return null;

  try {
    // Required late (not at module top) to avoid a hard circular-require
    // between config/ and repositories/ at startup.
    const practiceSettingsRepository = require('../repositories/PracticeSettingsRepository');
    const { mergePracticeConfig } = require('../services/practice/practiceMerge');
    const overrides = await practiceSettingsRepository.get(practiceId);
    return mergePracticeConfig(base, overrides);
  } catch (err) {
    console.error(`getPracticeResolved(${practiceId}): falling back to base config —`, err.message);
    return base;
  }
}

module.exports = { getPractice, getPracticeResolved, getDefaultPracticeId, listPracticeIds, getPracticeIdForPhoneNumber };
