/**
 * Development/demo SMS "provider" — never sends a real text message. See
 * MockEmailProvider.js for why this always reports `sent: false`.
 */

const SMSProvider = require('./SMSProvider');

class MockSMSProvider extends SMSProvider {
  async send({ to, body }) {
    console.log(`[MockSMSProvider] Would text ${to}: "${body}"`);
    return { sent: false, mocked: true, to };
  }
}

module.exports = MockSMSProvider;
