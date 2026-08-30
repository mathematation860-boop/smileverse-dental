/**
 * Resolves WHICH practice an API request is for, and attaches it to
 * `req.practice` / `req.practiceId` before any route handler runs.
 *
 * This is what makes multi-tenancy real rather than aspirational: every
 * route reads the practice from `req`, never from a hard-coded import, so
 * there is no code path where one practice's request can accidentally
 * read or write another practice's data. The practice is resolved from
 * (in priority order) an `X-Practice-Id` header, a `practiceId` query
 * param, or the server's configured default — the current single-tenant
 * frontend sends the header on every request (see frontend
 * services/api.js) but never has to think about it beyond that.
 */

const { getPractice, getPracticeResolved, getDefaultPracticeId } = require('../config/practiceRepository');

// Phase 3: resolves through getPracticeResolved so a practice's own
// dashboard-saved settings (name/hours/services/policies/etc — see
// config/practiceRepository.js and services/practice/practiceMerge.js)
// take effect on the public receptionist too, not just in the admin
// dashboard. getPracticeResolved already falls back to the static base
// config on any database error, so this stays as resilient as the old
// synchronous lookup was.
async function practiceContext(req, res, next) {
  const requestedId = req.headers['x-practice-id'] || req.query.practiceId || getDefaultPracticeId();
  if (!getPractice(requestedId)) {
    return res.status(404).json({ error: `Unknown practiceId "${requestedId}"` });
  }

  const practice = await getPracticeResolved(requestedId);
  req.practiceId = practice.practiceId;
  req.practice = practice;
  next();
}

module.exports = practiceContext;
