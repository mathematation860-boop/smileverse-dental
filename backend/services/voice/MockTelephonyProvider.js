const TelephonyProvider = require('./TelephonyProvider');
const twiml = require('./twimlBuilder');

/**
 * Demo/development telephony provider — no Twilio account, phone number,
 * or credentials required. This is what every practice actually runs on
 * today (practice.demoMode defaults to true for every practice — see
 * services/voice/index.js's selection logic, which mirrors
 * services/providers/index.js's appointment-provider gating exactly).
 *
 * It produces the SAME TwiML a real call would get (see twimlBuilder.js's
 * header comment) — the only things that make this "mock" rather than
 * "real" are `isConfigured()` reporting false and
 * `verifyWebhookSignature()` never claiming a signature was actually
 * verified. This is deliberate: a mock mode that quietly produced
 * different, fake-looking output would not be a trustworthy foundation to
 * later flip into production, and the Phase 4 spec explicitly forbids
 * pretending the voice system is live when it isn't (§3, §24).
 */
class MockTelephonyProvider extends TelephonyProvider {
  get providerName() {
    return 'mock';
  }

  isConfigured() {
    return false;
  }

  buildSayAndGatherResponse({ text, actionUrl, language }) {
    return twiml.buildSayAndGather({ text, actionUrl, language });
  }

  buildSayAndHangupResponse({ text, language }) {
    return twiml.buildSayAndHangup({ text, language });
  }

  buildTransferResponse({ text, transferTo, language }) {
    return twiml.buildTransfer({ text, transferTo, language });
  }

  /**
   * Mock mode has no signing secret, so there is nothing to cryptographically
   * verify. It reports `valid: true` (a mock call must still be usable end
   * to end for development/demo purposes) but with `reason:
   * 'unverified-mock-mode'` so callers — see routes/voice.js's structured
   * logging (Phase 4 spec §23) — can tell the difference between "this
   * request was verified" and "this practice isn't live yet, nothing to
   * verify against."
   */
  verifyWebhookSignature() {
    return { valid: true, reason: 'unverified-mock-mode' };
  }
}

module.exports = MockTelephonyProvider;
