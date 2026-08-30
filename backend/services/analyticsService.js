/**
 * Event-tracking abstraction (backend side).
 *
 * Every "moment that matters" (conversation started, appointment
 * requested/booked/cancelled/rescheduled, emergency request, human
 * handoff, unanswered question) is logged through this single function.
 * There's no real analytics pipeline behind this yet — events just land
 * in MongoDB — but nothing calling logEvent() needs to change when one
 * is added later.
 *
 * This never throws: analytics must never break the patient-facing flow.
 */

const AnalyticsEvent = require('../models/AnalyticsEvent');

async function logEvent(name, conversationId, payload = {}) {
  try {
    await AnalyticsEvent.create({ name, conversationId, payload });
  } catch (err) {
    console.error('Analytics log failed (non-fatal):', err.message);
  }
}

async function getSummary() {
  try {
    const rows = await AnalyticsEvent.aggregate([
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
