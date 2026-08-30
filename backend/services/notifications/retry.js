/**
 * Bounded retry with backoff for notification sends (Phase 5 spec §24).
 *
 * Only ever retries a "temporary" failure (a network blip, a provider's
 * own transient error) — a "permanent" failure (invalid phone/email,
 * blocked destination, misconfigured credentials) is retried zero times,
 * since trying the exact same doomed request again wastes provider quota
 * and delays the caller for no benefit. Idempotent by construction: each
 * attempt calls the exact same `sendFn` with the exact same arguments, so
 * retrying never double-sends anything a provider itself treats as a new
 * message — the bound (MAX_ATTEMPTS) is what keeps a persistently-failing
 * provider from being hammered forever.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;

// A failureReason matching one of these is a PERMANENT failure — never
// retried, regardless of how many attempts remain.
const PERMANENT_FAILURE_REASONS = new Set([
  'invalid_phone',
  'invalid_email',
  'blocked_destination',
  'twilio_not_configured',
  'sendgrid_not_configured',
  'consent_declined',
  'invalid_destination',
]);

function isPermanentFailure(failureReason) {
  return PERMANENT_FAILURE_REASONS.has(failureReason);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `sendFn()` (which must return the structured provider-result shape
 * — see EmailProvider.js) up to MAX_ATTEMPTS times, stopping as soon as it
 * succeeds or hits a permanent failure. Returns the LAST result, plus
 * `attempts` (how many tries actually happened).
 */
async function sendWithRetry(sendFn, { maxAttempts = MAX_ATTEMPTS, baseDelayMs = BASE_DELAY_MS, sleep = delay } = {}) {
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      lastResult = await sendFn();
    } catch (err) {
      lastResult = { success: false, simulated: false, providerMessageId: null, providerStatus: null, failureReason: 'provider_threw' };
    }

    if (lastResult.success || lastResult.simulated) {
      return { ...lastResult, attempts: attempt };
    }
    if (isPermanentFailure(lastResult.failureReason)) {
      return { ...lastResult, attempts: attempt };
    }
    if (attempt < maxAttempts) {
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { ...lastResult, attempts: maxAttempts };
}

module.exports = { sendWithRetry, isPermanentFailure, MAX_ATTEMPTS, PERMANENT_FAILURE_REASONS };
