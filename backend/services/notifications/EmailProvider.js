/**
 * Email provider interface. A real implementation (SendGrid, Resend,
 * Postmark, ...) would extend this and be selected in ./index.js based
 * on `practice.integrations.emailProvider` — nothing calling send()
 * needs to know or care which vendor is behind it.
 */
class EmailProvider {
  // eslint-disable-next-line no-unused-vars
  async send({ to, subject, body }) {
    throw new Error('EmailProvider.send() not implemented');
  }
}

module.exports = EmailProvider;
