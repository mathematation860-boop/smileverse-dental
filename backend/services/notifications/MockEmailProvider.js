/**
 * Demo/development email "provider" — NEVER sends a real email. It only
 * logs what would have been sent and honestly reports `success: false,
 * simulated: true` so a caller can never mistake this for a delivered
 * message (Phase 5 spec §3: "Demo notification simulated successfully" —
 * never "Email sent"). Never fabricates a providerMessageId that could be
 * mistaken for a real one.
 */

const EmailProvider = require('./EmailProvider');

class MockEmailProvider extends EmailProvider {
  get providerName() {
    return 'mock';
  }

  isConfigured() {
    return true; // the mock never needs real credentials
  }

  async send({ to, subject }) {
    console.log(JSON.stringify({ event: 'email_simulated', to: maskForLog(to), subject }));
    return {
      success: false,
      simulated: true,
      providerMessageId: null,
      providerStatus: 'simulated',
      failureReason: null,
      message: 'Demo notification simulated successfully.',
    };
  }
}

function maskForLog(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return '(none)';
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}***@${domain}`;
}

module.exports = MockEmailProvider;
