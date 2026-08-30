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

/** Counts of specific event names for a practice, e.g. { appointment_cancelled: 3, appointment_rescheduled: 1 }. Missing names are simply absent (never fabricated as 0 vs "unknown" — callers treat absent as 0). Never throws — degrades to an empty object like getSummary(). */
async function getEventCounts(practiceId, names) {
  try {
    const rows = await AnalyticsEvent.aggregate([
      { $match: { practiceId, name: { $in: names } } },
      { $group: { _id: '$name', count: { $sum: 1 } } },
    ]);
    return rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
  } catch (err) {
    console.error('Analytics event counts failed (non-fatal):', err.message);
    return {};
  }
}

/** Most recent appointment-lifecycle event (booked/rescheduled/cancelled) per conversationId, for the admin Conversations list — real logged data, never inferred. */
async function getLatestAppointmentEventsByConversation(practiceId, conversationIds) {
  if (!conversationIds || conversationIds.length === 0) return {};
  try {
    const rows = await AnalyticsEvent.find({
      practiceId,
      conversationId: { $in: conversationIds },
      name: { $in: ['appointment_booked', 'appointment_rescheduled', 'appointment_cancelled'] },
    }).sort({ createdAt: 1 }); // ascending so the LAST write per conversationId below is the most recent
    const byConversation = {};
    for (const row of rows) {
      byConversation[row.conversationId] = row.name;
    }
    return byConversation;
  } catch (err) {
    console.error('Analytics per-conversation lookup failed (non-fatal):', err.message);
    return {};
  }
}

module.exports = { logEvent, getSummary, getEventCounts, getLatestAppointmentEventsByConversation };
