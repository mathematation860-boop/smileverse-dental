/**
 * Voice receptionist interface — NOT implemented. This is a boundary
 * marker, not a feature: the explicit instruction for this phase is to
 * prepare the seam without building a full voice system.
 *
 * The key architectural rule for whenever voice IS built: it must call
 * the exact same backend/tools/receptionistTools.js functions the chat
 * AI uses (check availability, book, reschedule, cancel, answer FAQs,
 * request human handoff) rather than duplicating booking logic for a
 * phone call. A voice implementation would:
 *   1. Handle telephony + speech-to-text/text-to-speech (e.g. via
 *      Twilio Voice + a streaming STT/TTS provider) — entirely new code.
 *   2. Feed the transcribed utterance into the SAME AIProvider used by
 *      chat (services/ai/index.js) to get intent + entities.
 *   3. Call the SAME tools in receptionistTools.js to act on it.
 *   4. Speak the resulting `reply` text back via TTS.
 * This class exists so that boundary is written down before anyone is
 * tempted to hand-roll a second booking pipeline for phone calls.
 */
class VoiceReceptionist {
  // eslint-disable-next-line no-unused-vars
  async handleUtterance(practice, callSessionId, transcribedText) {
    throw new Error(
      'VoiceReceptionist is not implemented yet. When it is, it must call the same ' +
      'backend/tools/receptionistTools.js functions and services/ai AIProvider that ' +
      'chat already uses — see this file\'s header comment.'
    );
  }
}

module.exports = VoiceReceptionist;
