/**
 * Voice provider factory — same two-key safety gate as
 * services/providers/index.js (the appointment/calendar provider
 * factory), applied to telephony: `practice.demoMode` is the master
 * switch. As long as it's true — the default for every practice — this
 * ALWAYS returns the mock telephony provider, regardless of what
 * `integrations.voiceProvider` says. Real Twilio calls only ever happen
 * for a practice with BOTH `demoMode: false` AND
 * `integrations.voiceProvider: 'twilio'`, which is a deliberate, reviewed
 * config-file change — never something a runtime request (or an admin
 * settings form — see services/practice/practiceMerge.js, which hard-codes
 * `integrations` and `demoMode` as always coming from the static base
 * config) can flip.
 */

const MockTelephonyProvider = require('./MockTelephonyProvider');
const TwilioTelephonyProvider = require('./TwilioTelephonyProvider');
const TwilioNativeSpeechProvider = require('./TwilioNativeSpeechProvider');
const TelephonyNativeTextToSpeechProvider = require('./TelephonyNativeTextToSpeechProvider');

const mockInstance = new MockTelephonyProvider();
let twilioInstance = null;

function getTelephonyProvider(practice) {
  if (practice?.demoMode !== false) return mockInstance;

  const providerName = practice?.integrations?.voiceProvider || 'mock';
  switch (providerName) {
    case 'twilio':
      if (!twilioInstance) twilioInstance = new TwilioTelephonyProvider();
      return twilioInstance;
    case 'mock':
      return mockInstance;
    default:
      console.warn(`No real "${providerName}" telephony provider is implemented yet — falling back to the mock provider.`);
      return mockInstance;
  }
}

// Only one implementation of each exists today (Twilio's built-in speech
// recognition and TTS voice cover both interfaces — see each file's header
// comment for why), so these are not yet practice-selected the way
// telephony/appointments are. They're still exposed as their own
// interfaces/classes so a future second implementation is a new class +
// a switch here, not a rewrite of routes/voice.js.
function getSpeechToTextProvider(_practice) {
  return new TwilioNativeSpeechProvider();
}

function getTextToSpeechProvider(_practice) {
  return new TelephonyNativeTextToSpeechProvider();
}

module.exports = { getTelephonyProvider, getSpeechToTextProvider, getTextToSpeechProvider };
