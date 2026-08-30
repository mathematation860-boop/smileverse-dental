const SpeechToTextProvider = require('./SpeechToTextProvider');

/**
 * Pass-through STT "provider" for Twilio Voice: Twilio's own
 * <Gather input="speech"> already transcribed the caller's utterance
 * before our webhook was even called (see TwilioTelephonyProvider /
 * MockTelephonyProvider — both produce a <Gather> whose action webhook
 * receives `SpeechResult` + `Confidence` in the POST body). This class
 * exists so routes/voice.js and the engine always call a
 * SpeechToTextProvider interface uniformly, even though no second network
 * call happens on this path — see this file's SpeechToTextProvider.js
 * header comment for the honest reasoning.
 */
class TwilioNativeSpeechProvider extends SpeechToTextProvider {
  async transcribe({ text, audio: _audio }) {
    return { text: (text || '').trim(), confidence: null };
  }
}

module.exports = TwilioNativeSpeechProvider;
