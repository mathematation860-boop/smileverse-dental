/**
 * Telephony provider interface — the seam between "a phone call is
 * happening" and everything else in this app. A real implementation
 * (TwilioTelephonyProvider) and a credential-free implementation
 * (MockTelephonyProvider) both implement this same shape, selected per
 * practice by ./index.js exactly the way services/providers/index.js
 * already does for the appointment/calendar provider — so nothing else in
 * the app (routes/voice.js, services/voice/voiceReceptionistEngine.js)
 * ever needs to know or care which one is actually running.
 *
 * Every method here returns/produces TwiML (Twilio Markup Language) XML —
 * that's a deliberate, narrow choice, not an accident: TwiML is a
 * telephony-response format most voice carriers/providers that offer a
 * "point a phone number at a webhook" model can consume in some form, and
 * choosing ONE concrete response shape (rather than a vaguer abstraction)
 * keeps this interface honest about what it actually produces instead of
 * pretending to be more provider-agnostic than it is. A future non-Twilio
 * provider would still need to translate to/from its own call-control
 * format; this interface only guarantees routes/voice.js never has to
 * know which provider it's talking to.
 */
class TelephonyProvider {
  /** Human-readable name, surfaced on the admin Voice settings page. */
  get providerName() {
    throw new Error('TelephonyProvider.providerName not implemented');
  }

  /** Whether this provider has everything it needs (credentials, phone number) to be considered "live" rather than a safe mock. */
  isConfigured() {
    throw new Error('TelephonyProvider.isConfigured() not implemented');
  }

  /**
   * Builds the TwiML response for "greet the caller, then listen for
   * speech and POST the transcript to `actionUrl`".
   * @param {object} params
   * @param {string} params.text - what to say (already practice-grounded; never hard-coded here)
   * @param {string} params.actionUrl - absolute webhook URL Twilio should POST the caller's speech result to
   * @param {'en-US'|'ur-PK'} [params.language]
   * @returns {string} TwiML XML
   */
  // eslint-disable-next-line no-unused-vars
  buildSayAndGatherResponse({ text, actionUrl, language }) {
    throw new Error('TelephonyProvider.buildSayAndGatherResponse() not implemented');
  }

  /** Builds the TwiML response for "say this, then hang up" (a terminal turn — emergency safety message, a completed goodbye, an unrecoverable failure). */
  // eslint-disable-next-line no-unused-vars
  buildSayAndHangupResponse({ text, language }) {
    throw new Error('TelephonyProvider.buildSayAndHangupResponse() not implemented');
  }

  /**
   * Builds the TwiML response for a human handoff: say a short transition
   * line, then transfer the call. `transferTo` may be null (no front-desk
   * number configured yet) — implementations must fall back to a safe
   * "please call us back at X" message rather than attempting a transfer
   * to nothing.
   */
  // eslint-disable-next-line no-unused-vars
  buildTransferResponse({ text, transferTo, language }) {
    throw new Error('TelephonyProvider.buildTransferResponse() not implemented');
  }

  /**
   * Verifies an inbound webhook actually came from this provider (never
   * trust an unverified webhook — see Phase 4 spec §21/§22). Returns
   * `{ valid: boolean, reason?: string }`. A provider with no signing
   * mechanism configured (e.g. mock mode) should return
   * `{ valid: true, reason: 'unverified-mock-mode' }` so callers can log
   * the distinction rather than silently treating mock mode as verified.
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhookSignature({ signatureHeader, fullUrl, params }) {
    throw new Error('TelephonyProvider.verifyWebhookSignature() not implemented');
  }
}

module.exports = TelephonyProvider;
