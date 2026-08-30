/**
 * Notification provider factories — the SAME demoMode-gated two-key
 * pattern as services/providers/index.js (Phase 2, calendar) and
 * services/voice/index.js (Phase 4, telephony): `practice.demoMode` is the
 * master switch. As long as it's true — the default for every practice —
 * this ALWAYS returns the mock provider, regardless of what
 * `integrations.emailProvider`/`integrations.smsProvider` say. A real
 * provider is only ever selected for a practice with BOTH
 * `demoMode: false` AND the matching `integrations.*Provider` set, which is
 * a deliberate, reviewed config-file change — never something a runtime
 * request or an admin settings form can flip (see
 * services/practice/practiceMerge.js, which hard-codes `demoMode` and
 * `integrations` as always coming from the static base config).
 *
 * Call sites (notificationService.js) still check the returned provider's
 * own `isConfigured()` before claiming anything is "live" — selecting the
 * Twilio/SendGrid class does not by itself mean real credentials exist
 * (Phase 5 spec §4/§30: never silently fall back to a fake success, but
 * also never claim "live" just because a class got selected).
 */

const MockEmailProvider = require('./MockEmailProvider');
const MockSMSProvider = require('./MockSMSProvider');
const SendGridEmailProvider = require('./SendGridEmailProvider');
const TwilioSMSProvider = require('./TwilioSMSProvider');

const mockEmail = new MockEmailProvider();
const mockSms = new MockSMSProvider();
let sendGridInstance = null;
let twilioSmsInstance = null;

function getEmailProvider(practice) {
  if (practice?.demoMode !== false) return mockEmail;

  const providerName = practice?.integrations?.emailProvider || 'mock';
  switch (providerName) {
    case 'sendgrid':
      if (!sendGridInstance) sendGridInstance = new SendGridEmailProvider();
      return sendGridInstance;
    case 'mock':
      return mockEmail;
    default:
      console.warn(`No real "${providerName}" email provider is implemented yet — falling back to the mock provider.`);
      return mockEmail;
  }
}

function getSmsProvider(practice) {
  if (practice?.demoMode !== false) return mockSms;

  const providerName = practice?.integrations?.smsProvider || 'mock';
  switch (providerName) {
    case 'twilio':
      if (!twilioSmsInstance) twilioSmsInstance = new TwilioSMSProvider();
      return twilioSmsInstance;
    case 'mock':
      return mockSms;
    default:
      console.warn(`No real "${providerName}" SMS provider is implemented yet — falling back to the mock provider.`);
      return mockSms;
  }
}

/** Fire-and-forget helper — logs but never throws, so a notification issue never breaks the caller's response. Kept for any legacy caller; notificationService.js's own sendNotification() has its own equivalent guarantee plus history logging, and is preferred for anything new. */
async function notifySafely(providerCall) {
  try {
    await providerCall();
  } catch (err) {
    console.error('Notification failed (non-fatal):', err.message);
  }
}

module.exports = { getEmailProvider, getSmsProvider, notifySafely };
