/**
 * SMS provider interface. A real implementation (Twilio, etc.) would
 * extend this and be selected in ./index.js based on
 * `practice.integrations.smsProvider`.
 */
class SMSProvider {
  // eslint-disable-next-line no-unused-vars
  async send({ to, body }) {
    throw new Error('SMSProvider.send() not implemented');
  }
}

module.exports = SMSProvider;
