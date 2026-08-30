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

module.exports = { getPractice, getPracticeResolved, getDefaultPracticeId, listPracticeIds };
