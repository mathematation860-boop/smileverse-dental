const NotificationLog = require('../models/NotificationLog');

/**
 * Notification history data access — every query scoped by practiceId,
 * same convention as every other repository in this codebase (see
 * repositories/CallLogRepository.js's header comment).
 *
 * The two-step claim()/updateResult() flow is what makes "never send the
 * same notification twice" true even under concurrent requests, a server
 * restart mid-send, or multiple running instances (Phase 5 spec §9):
 * `claim()` performs a single atomic insert on the unique `idempotencyKey`
 * index BEFORE any provider call is attempted. If a second caller (a
 * retried webhook, a second reminder-poll tick, another instance) tries to
 * claim the exact same key, MongoDB's own unique-index constraint rejects
 * the second insert — `claim()` reports that as `null` (already claimed),
 * and the caller must treat that as "someone else is already handling
 * this, do not send again" rather than an error.
 */

/** Attempts to atomically claim one notification slot. Returns the newly-created document on success, or `null` if `idempotencyKey` was already claimed (by this process or another) — the caller must NOT send anything in that case. */
async function claim(practiceId, idempotencyKey, meta = {}) {
  try {
    const doc = await NotificationLog.create({
      practiceId,
      idempotencyKey,
      status: 'failed', // placeholder until updateResult() sets the real outcome; never left this way on purpose
      type: meta.type,
      channel: meta.channel,
      language: meta.language || 'en',
      appointmentId: meta.appointmentId || null,
      conversationId: meta.conversationId || null,
      callSid: meta.callSid || null,
      destinationMasked: meta.destinationMasked || null,
      demoMode: meta.demoMode !== false,
      attempts: 0,
    });
    return doc;
  } catch (err) {
    if (err && err.code === 11000) {
      // Duplicate key — another attempt already claimed this exact
      // notification. This is the expected, safe outcome of a race, not a
      // real error.
      return null;
    }
    throw err;
  }
}

/** Records the actual outcome of a claimed attempt — the ONLY place a document's status ever moves out of the claim() placeholder. */
async function updateResult(id, { status, provider, providerMessageId, providerStatus, failureReason, attempts }) {
  return NotificationLog.findByIdAndUpdate(
    id,
    { $set: { status, provider: provider || null, providerMessageId: providerMessageId || null, providerStatus: providerStatus || null, failureReason: failureReason || null, attempts: attempts || 1 } },
    { new: true }
  );
}

/** Looks up a notification by its provider message id, scoped to a practice — used by delivery-status webhooks (spec §21) to update the right record without trusting anything else the webhook claims. */
async function findByProviderMessageId(practiceId, providerMessageId) {
  if (!providerMessageId) return null;
  return NotificationLog.findOne({ practiceId, providerMessageId });
}

/** Updates a previously-sent notification's status from a provider's own delivery-status webhook (spec §21) — scoped to practiceId so a forged/mismatched webhook could never touch another practice's history. Naturally idempotent: Twilio (or any provider) retrying the same status callback just sets the same fields again, never creates a duplicate row. */
async function updateStatusByProviderMessageId(practiceId, providerMessageId, { status, providerStatus, failureReason }) {
  if (!providerMessageId) return null;
  return NotificationLog.findOneAndUpdate(
    { practiceId, providerMessageId },
    { $set: { ...(status ? { status } : {}), ...(providerStatus ? { providerStatus } : {}), ...(failureReason !== undefined ? { failureReason } : {}) } },
    { new: true }
  );
}

async function listForPractice(practiceId, { limit = 200 } = {}) {
  return NotificationLog.find({ practiceId }).sort({ createdAt: -1 }).limit(limit);
}

/** Real, aggregated notification stats for the admin dashboard (spec §17) — every number comes from actually-logged documents; an empty history reports 0s, never fabricated sample data. */
async function getSummary(practiceId) {
  const rows = await NotificationLog.find({ practiceId });
  const total = rows.length;
  const sent = rows.filter((r) => r.status === 'sent').length;
  const failed = rows.filter((r) => r.status === 'failed').length;
  const simulated = rows.filter((r) => r.status === 'simulated').length;
  const byChannel = {
    sms: rows.filter((r) => r.channel === 'sms').length,
    email: rows.filter((r) => r.channel === 'email').length,
  };
  return { total, sent, failed, simulated, byChannel };
}

module.exports = { claim, updateResult, findByProviderMessageId, updateStatusByProviderMessageId, listForPractice, getSummary };
