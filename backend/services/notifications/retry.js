/**
 * Bounded retry with backoff for notification sends (Phase 5 spec §24).
 *
 * Only ever retries a "temporary" failure (a network blip, a provider's
 * own transient error) — a "permanent" failure (invalid phone/email,
 * blocked destination, misconfigured credentials) is retried zero times,
 * since trying the exact same doomed request again wastes provider quota
 * and delays the caller for no benefit. The bound (MAX_ATTEMPTS) is what
 * keeps a persistently-failing provider from being hammered forever.
 *
 * CORRECTION (audit, Sept 2026). This header used to claim the retry was
 * "idempotent by construction ... retrying never double-sends anything a
 * provider itself treats as a new message". That is not true, and the code
 * never made it true. Calling the same function with the same arguments is
 * not idempotency: an SMS API treats each request as a new message unless
 * something in the request tells it otherwise, and nothing here does.
 *
 * The consequence is real but bounded. A THROWN provider error is recorded
 * as `provider_threw`, which is not on the permanent list, so it is
 * retried — and a throw is exactly the case where we cannot tell whether
 * the message was delivered before the connection broke. A provider that
 * accepts a message and then fails to answer can therefore be sent the
 * same message up to MAX_ATTEMPTS times.
 *
 * Deliberately NOT changed here: making a throw permanent would trade a
 * duplicate reminder for a missed one, which is the worse failure for a
 * clinic, and doing it properly needs a per-message idempotency key the
 * provider honours. Recorded as a finding with a test that pins the
 * current behaviour (tests/notificationCrashWindows.test.js) rather than
 * changed quietly. Applies only once a REAL provider is enabled; the mock
 * providers that run today never throw.
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
