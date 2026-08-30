const TextToSpeechProvider = require('./TextToSpeechProvider');

/**
 * Default TextToSpeechProvider: defers entirely to the telephony
 * provider's own built-in voice (Twilio's TwiML <Say>). See
 * TextToSpeechProvider.js's header comment for when a real synthesis
 * provider would replace this.
 */
class TelephonyNativeTextToSpeechProvider extends TextToSpeechProvider {
  async synthesize({ text }) {
    return { mode: 'inline', text };
  }
}

module.exports = TelephonyNativeTextToSpeechProvider;
