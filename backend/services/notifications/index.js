/**
 * Notification provider factories, keyed off each practice's
 * `integrations.emailProvider` / `integrations.smsProvider`. Every
 * practice is 'mock' today (see config/practices/*.js) — real
 * credentials are never required for the app to run, and nothing here
 * ever claims a message was actually delivered when it wasn't (see the
 * Mock*Provider `sent: false` contract).
 *
 * Call sites (appointments/handoff routes) treat every notification as
 * fire-and-forget best-effort: a notification failure must never fail
 * the booking/cancellation/handoff it's attached to.
 */

const MockEmailProvider = require('./MockEmailProvider');
const MockSMSProvider = require('./MockSMSProvider');

const mockEmail = new MockEmailProvider();
const mockSms = new MockSMSProvider();

function getEmailProvider(practice) {
  const providerName = practice?.integrations?.emailProvider || 'mock';
  switch (providerName) {
    case 'mock':
    default:
      return mockEmail;
  }
}

function getSmsProvider(practice) {
  const providerName = practice?.integrations?.smsProvider || 'mock';
  switch (providerName) {
    case 'mock':
    default:
      return mockSms;
  }
}

/** Fire-and-forget helper — logs but never throws, so a notification issue never breaks the caller's response. */
async function notifySafely(providerCall) {
  try {
    await providerCall();
  } catch (err) {
    console.error('Notification failed (non-fatal):', err.message);
  }
}

module.exports = { getEmailProvider, getSmsProvider, notifySafely };
