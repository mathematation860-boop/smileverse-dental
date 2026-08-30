const AnalyticsEvent = require('../models/AnalyticsEvent');

// Analytics must NEVER be able to break the request it's attached to —
// a booking, a chat reply, an emergency safety message all must succeed
// even if the database is down. This deliberately swallows its own
// errors (logging them) rather than letting a caller's try/catch around
// unrelated logic accidentally hide an analytics failure — or worse,
// as happened during development here, accidentally propagate one and
// fail an otherwise-successful request.
async function logEvent(practiceId, name, conversationId, payload = {}) {
  try {
    await AnalyticsEvent.create({ practiceId, name, conversationId, payload });
  } catch (err) {
    console.error('Analytics log failed (non-fatal):', err.message);
  }
}

async function getSummary(practiceId) {
  try {
    const rows = await AnalyticsEvent.aggregate([
      { $match: { practiceId } },
      { $group: { _id: '$name', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    return rows.map((r) => ({ name: r._id, count: r.count }));
  } catch (err) {
    console.error('Analytics summary failed (non-fatal):', err.message);
    return [];
  }
}

module.exports = { logEvent, getSummary };
