/**
 * Demo/development SMS "provider" — see MockEmailProvider.js for why this
 * always reports `success: false, simulated: true` and never a fabricated
 * message id.
 */

const SMSProvider = require('./SMSProvider');

class MockSMSProvider extends SMSProvider {
  get providerName() {
    return 'mock';
  }

  isConfigured() {
    return true;
  }

  async send({ to }) {
    console.log(JSON.stringify({ event: 'sms_simulated', to: maskForLog(to) }));
    return {
      success: false,
      simulated: true,
      providerMessageId: null,
      providerStatus: 'simulated',
      failureReason: null,
      message: 'Demo notification simulated successfully.',
    };
  }

  verifyWebhookSignature() {
    // The mock provider has no real inbound webhooks — never claim a mock
    // request is a "verified" one (Phase 5 spec §21).
    return { valid: false, reason: 'mock-provider-no-real-webhooks' };
  }
}

function maskForLog(phone) {
  if (!phone) return '(none)';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-4)}`;
}

module.exports = MockSMSProvider;
