/**
 * Speech-to-text provider interface.
 *
 * Honest architecture note: with the chosen telephony provider (Twilio
 * Voice's <Gather input="speech">), speech recognition happens INSIDE the
 * telephony leg itself — Twilio listens on the live call and POSTs the
 * already-transcribed text (`SpeechResult`) to our webhook. There is no
 * separate network hop this app makes to a standalone STT API for that
 * path, so TwilioNativeSpeechProvider below is a thin pass-through, not a
 * real second integration.
 *
 * This interface still exists, as the spec requires, so that a future
 * provider needing a REAL separate STT step (e.g. a raw media-stream
 * integration, or a non-Twilio telephony provider with no built-in
 * recognizer) has a seam to implement against without changing
 * routes/voice.js or services/voice/voiceReceptionistEngine.js — both of
 * which only ever call `transcribe()`, never a vendor SDK directly.
 */
class SpeechToTextProvider {
  /**
   * @param {object} params
   * @param {string} [params.text] - already-transcribed text, when the telephony leg did the recognition itself (Twilio's case)
   * @param {Buffer} [params.audio] - raw audio, for a provider that must transcribe it itself
   * @returns {Promise<{ text: string, confidence: number|null }>}
   */
  // eslint-disable-next-line no-unused-vars
  async transcribe({ text, audio }) {
    throw new Error('SpeechToTextProvider.transcribe() not implemented');
  }
}

module.exports = SpeechToTextProvider;
