const twilio = require('twilio');
const TelephonyProvider = require('./TelephonyProvider');
const twimlLib = require('./twimlBuilder');

/**
 * Real Twilio Voice adapter — the production-grade telephony provider
 * this phase is built around (see README/Phase 4 report for why Twilio:
 * mature Voice API, built-in speech recognition via <Gather input="speech">
 * removing the need for a separate real-time STT integration, built-in
 * TTS via <Say>, and a well-documented request-signature verification
 * scheme for webhook security).
 *
 * This class is written and wired end-to-end, but it is only ever
 * SELECTED for a practice that has both `demoMode: false` and
 * `integrations.voiceProvider: 'twilio'` set in its config file (see
 * ./index.js) — the exact same two-key gate Phase 2's
 * GoogleCalendarAppointmentProvider uses, so a practice can never end up
 * on real telephony by accident. No practice ships with those two keys
 * set today, and this class has never been exercised against a real
 * Twilio account or a real phone call — see the Phase 4 report's "what is
 * genuinely live vs mocked" section. `isConfigured()` reflects this
 * honestly at runtime by checking the actual required env vars, not just
 * which class got selected.
 */
class TwilioTelephonyProvider extends TelephonyProvider {
  constructor({ accountSid = process.env.TWILIO_ACCOUNT_SID, authToken = process.env.TWILIO_AUTH_TOKEN } = {}) {
    super();
    this.accountSid = accountSid;
    this.authToken = authToken;
  }

  get providerName() {
    return 'twilio';
  }

  isConfigured() {
    return Boolean(this.accountSid && this.authToken);
  }

  buildSayAndGatherResponse({ text, actionUrl, language }) {
    return twimlLib.buildSayAndGather({ text, actionUrl, language });
  }

  buildSayAndHangupResponse({ text, language }) {
    return twimlLib.buildSayAndHangup({ text, language });
  }

  buildTransferResponse({ text, transferTo, language }) {
    return twimlLib.buildTransfer({ text, transferTo, language });
  }

  /**
   * Twilio signs every webhook request with an HMAC-SHA1 signature (the
   * `X-Twilio-Signature` header) derived from the auth token, the exact
   * request URL, and the sorted POST parameters. `twilio.validateRequest`
   * recomputes that signature and compares it — this is what makes forged
   * webhook requests (Phase 4 spec §22) rejectable: without the real auth
   * token, an attacker cannot produce a signature that matches.
   */
  verifyWebhookSignature({ signatureHeader, fullUrl, params }) {
    if (!this.isConfigured()) {
      return { valid: false, reason: 'twilio-not-configured' };
    }
    if (!signatureHeader) {
      return { valid: false, reason: 'missing-signature' };
    }
    const valid = twilio.validateRequest(this.authToken, signatureHeader, fullUrl, params || {});
    return { valid, reason: valid ? 'verified' : 'signature-mismatch' };
  }
}

module.exports = TwilioTelephonyProvider;
