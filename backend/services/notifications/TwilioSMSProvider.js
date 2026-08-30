const SMSProvider = require('./SMSProvider');

/**
 * Real Twilio Programmable SMS adapter (Phase 5 spec §22: "inspect the
 * project and choose an appropriate provider architecture" — Twilio is
 * already this project's telephony vendor as of Phase 4, so reusing the
 * same account for SMS avoids introducing a second vendor/credential set
 * for no reason, and reuses the exact same `twilio` npm package already a
 * dependency).
 *
 * Written and wired end-to-end, but — exactly like Phase 4's
 * TwilioTelephonyProvider — only ever SELECTED for a practice with BOTH
 * `demoMode: false` AND `integrations.smsProvider: 'twilio'` (see
 * ./index.js). No practice ships with those set today, and this class has
 * never been exercised against a real Twilio account or sent a real text
 * message — see the Phase 5 report's "what is genuinely live vs mocked"
 * section. `isConfigured()` checks the actual env vars at call time, never
 * assumes.
 */
class TwilioSMSProvider extends SMSProvider {
  constructor({
    accountSid = process.env.TWILIO_ACCOUNT_SID,
    authToken = process.env.TWILIO_AUTH_TOKEN,
    fromNumber = process.env.TWILIO_SMS_FROM_NUMBER,
    statusCallbackUrl = process.env.TWILIO_SMS_STATUS_CALLBACK_URL,
  } = {}) {
    super();
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
    // Optional (spec §21) — when set, Twilio POSTs a real delivery-status
    // update to routes/smsWebhook.js's /status endpoint after this
    // synchronous send() call returns. Without it, this provider still
    // honestly reports whatever Twilio's create() response itself said
    // (e.g. "queued") — never a fabricated "delivered".
    this.statusCallbackUrl = statusCallbackUrl;
    this._client = null;
  }

  get providerName() {
    return 'twilio';
  }

  isConfigured() {
    return Boolean(this.accountSid && this.authToken && this.fromNumber);
  }

  _getClient() {
    if (!this._client) {
      // Required lazily, not at module top: keeps the mock-only test/CI
      // path from ever needing a real twilio client instantiated, and
      // matches TwilioTelephonyProvider.js's own pattern.
      const twilio = require('twilio');
      this._client = twilio(this.accountSid, this.authToken);
    }
    return this._client;
  }

  async send({ to, body }) {
    if (!this.isConfigured()) {
      return {
        success: false,
        simulated: false,
        providerMessageId: null,
        providerStatus: null,
        failureReason: 'twilio_not_configured',
      };
    }
    try {
      const client = this._getClient();
      const message = await client.messages.create({
        to,
        from: this.fromNumber,
        body,
        ...(this.statusCallbackUrl ? { statusCallback: this.statusCallbackUrl } : {}),
      });
      // Twilio accepts a message into its queue synchronously; genuine
      // delivery confirmation arrives later via the status callback webhook
      // (see routes/smsWebhook.js). "success" here means Twilio itself
      // accepted the send request — never claim more than that up front.
      const accepted = !['failed', 'undelivered'].includes(message.status);
      return {
        success: accepted,
        simulated: false,
        providerMessageId: message.sid || null,
        providerStatus: message.status || null,
        failureReason: accepted ? null : `twilio_status_${message.status}`,
      };
    } catch (err) {
      return {
        success: false,
        simulated: false,
        providerMessageId: null,
        providerStatus: null,
        failureReason: classifyTwilioError(err),
      };
    }
  }

  /** Reuses the exact same HMAC-SHA1 request-signature scheme Twilio uses for voice webhooks (see TwilioTelephonyProvider.js) — SMS webhooks are signed the identical way. */
  verifyWebhookSignature({ signatureHeader, fullUrl, params }) {
    if (!this.isConfigured()) {
      return { valid: false, reason: 'twilio-not-configured' };
    }
    if (!signatureHeader) {
      return { valid: false, reason: 'missing-signature' };
    }
    const twilio = require('twilio');
    const valid = twilio.validateRequest(this.authToken, signatureHeader, fullUrl, params || {});
    return { valid, reason: valid ? 'verified' : 'signature-mismatch' };
  }
}

/** Maps a handful of well-known Twilio error codes to a stable, non-secret failure reason string — never the raw error message (which can include account-identifying detail), never a stack trace. */
function classifyTwilioError(err) {
  const code = err && err.code;
  const PERMANENT_CODES = {
    21211: 'invalid_phone',
    21614: 'invalid_phone',
    21610: 'blocked_destination', // recipient has opted out (STOP)
    21408: 'blocked_destination', // permission/geographic restriction
  };
  if (code && PERMANENT_CODES[code]) return PERMANENT_CODES[code];
  return 'provider_error';
}

module.exports = TwilioSMSProvider;
