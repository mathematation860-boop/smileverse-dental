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

module.exports = { getPractice, getDefaultPracticeId, listPracticeIds };
