/**
 * SMS provider interface (Phase 5 spec §2) — see EmailProvider.js's header
 * for the full structured-result contract every implementation returns.
 */
class SMSProvider {
  // eslint-disable-next-line no-unused-vars
  async send({ to, body }) {
    throw new Error('SMSProvider.send() not implemented');
  }

  /** See EmailProvider.isConfigured(). */
  isConfigured() {
    return true;
  }

  /**
   * Verifies an inbound webhook (a status callback, or an inbound message)
   * genuinely came from this provider. The mock provider has no real
   * webhooks to verify, so it always reports itself unverifiable (never
   * pretends a mock webhook is "signed"). Real implementations must
   * actually check a cryptographic signature — see TwilioSMSProvider.js.
   */
  // eslint-disable-next-line no-unused-vars
  verifyWebhookSignature({ signatureHeader, fullUrl, params }) {
    return { valid: false, reason: 'not-implemented' };
  }
}

module.exports = SMSProvider;
