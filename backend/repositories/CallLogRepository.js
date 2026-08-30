const CallLog = require('../models/CallLog');

/** Called once, on the very first webhook for a call (routes/voice.js's /voice/incoming). Never fabricates any outcome — every field here is either directly off the incoming webhook or a safe default that later events update. */
async function startCall(practiceId, { callSid, fromNumber, toNumber, demoMode }) {
  // A retried/duplicate "incoming call" webhook for the same CallSid (Twilio
  // does retry webhooks that don't respond fast enough) must never create a
  // second row for one real phone call — upsert on the unique callSid.
  const call = await CallLog.findOneAndUpdate(
    { callSid },
    { $setOnInsert: { practiceId, callSid, fromNumber, toNumber, demoMode, status: 'in_progress', outcome: 'unknown', startedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return call;
}

/** Called after every turn (routes/voice.js's /voice/gather) with whatever real, already-determined facts that turn produced — never a guess about how the call will eventually end. */
async function recordTurn(callSid, { outcome, appointmentCreated, handoffRequested, emergencyDetected } = {}) {
  const update = { $inc: { turnCount: 1 } };
  const set = {};
  if (outcome) set.outcome = outcome;
  if (appointmentCreated) set.appointmentCreated = true;
  if (handoffRequested) set.handoffRequested = true;
  if (emergencyDetected) set.emergencyDetected = true;
  if (Object.keys(set).length > 0) update.$set = set;
  return CallLog.findOneAndUpdate({ callSid }, update, { new: true });
}

/** Called from the telephony provider's status callback (routes/voice.js's /voice/status) — the only place a call's FINAL status is genuinely known. */
async function endCall(callSid, { status, durationSeconds } = {}) {
  const set = { endedAt: new Date() };
  if (status) set.status = status;
  if (typeof durationSeconds === 'number' && !Number.isNaN(durationSeconds)) set.durationSeconds = durationSeconds;
  return CallLog.findOneAndUpdate({ callSid }, { $set: set }, { new: true });
}

/** Practice-scoped call history, newest first (admin Call History page — Phase 4 spec §20). Never returns another practice's rows. */
async function listForPractice(practiceId, { limit = 100 } = {}) {
  return CallLog.find({ practiceId }).sort({ startedAt: -1 }).limit(limit);
}

/**
 * Real, aggregated call stats for the admin Voice dashboard tile row
 * (Phase 4 spec §19) — every number here comes from actually-logged
 * CallLog documents; an empty history reports 0s, never fabricated
 * sample data.
 */
async function getSummary(practiceId) {
  const rows = await CallLog.find({ practiceId });
  const total = rows.length;
  const answered = rows.filter((r) => r.turnCount > 0).length;
  const transferred = rows.filter((r) => r.handoffRequested).length;
  const missed = rows.filter((r) => r.status === 'no_answer' || r.status === 'busy' || (r.status === 'failed' && r.turnCount === 0)).length;
  const appointmentConversions = rows.filter((r) => r.appointmentCreated).length;
  const withDuration = rows.filter((r) => typeof r.durationSeconds === 'number');
  const avgDurationSeconds = withDuration.length > 0
    ? Math.round(withDuration.reduce((sum, r) => sum + r.durationSeconds, 0) / withDuration.length)
    : 0;

  return { total, answered, transferred, missed, appointmentConversions, avgDurationSeconds };
}

module.exports = { startCall, recordTurn, endCall, listForPractice, getSummary };
