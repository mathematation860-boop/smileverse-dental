/**
 * Text-to-speech provider interface.
 *
 * Honest architecture note: the chosen telephony provider (Twilio Voice)
 * has a built-in TTS voice via TwiML's <Say> tag — TelephonyProvider's
 * response builders (buildSayAndGatherResponse, etc.) already wrap text
 * in <Say> themselves, so no separate synthesis call happens for the
 * default path (see TelephonyNativeTextToSpeechProvider below).
 *
 * This interface exists for the day a practice wants a custom/branded
 * voice (e.g. ElevenLabs, Google Cloud TTS, Amazon Polly directly): a real
 * implementation would synthesize `text` to an audio file, upload/host it
 * somewhere reachable by the telephony provider, and return a URL that
 * TelephonyProvider's response builders can wrap in a TwiML <Play> instead
 * of <Say>. Nothing in this phase requires that — it is explicitly out of
 * scope per the Phase 4 spec's "do not overengineer" instruction — but the
 * seam is here so it doesn't require touching routes/voice.js later.
 */
class TextToSpeechProvider {
  /**
   * @param {object} params
   * @param {string} params.text
   * @param {'en-US'|'ur-PK'} [params.language]
   * @returns {Promise<{ mode: 'inline', text: string } | { mode: 'audio-url', url: string }>}
   *   'inline' means "let the telephony provider's own native voice speak
   *   this text" (the only mode implemented today); 'audio-url' is the
   *   seam for a future custom-voice provider.
   */
  // eslint-disable-next-line no-unused-vars
  async synthesize({ text, language }) {
    throw new Error('TextToSpeechProvider.synthesize() not implemented');
  }
}

module.exports = TextToSpeechProvider;
