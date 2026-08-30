/**
 * Development/demo email "provider" — never sends a real email. It only
 * logs what WOULD have been sent, and honestly reports `sent: false` so
 * a caller can never mistake this for a delivered message. Swapping in a
 * real provider later (see EmailProvider.js) is what actually sends mail.
 */

const EmailProvider = require('./EmailProvider');

class MockEmailProvider extends EmailProvider {
  async send({ to, subject, body }) {
    console.log(`[MockEmailProvider] Would send email to ${to} — subject: "${subject}"`);
    return { sent: false, mocked: true, to, subject };
  }
}

module.exports = MockEmailProvider;
