/**
 * AI provider interface.
 *
 * The rest of the app (routes/chat.js) talks to "an AI provider", never
 * to "Gemini" specifically. Swapping the underlying model/vendor later —
 * a different Google model, a different vendor entirely — means writing
 * one new class that implements this interface and registering it in
 * ./index.js; nothing in routes/chat.js or the frontend changes.
 */
class AIProvider {
  /**
   * Understand a patient message and produce a reply.
   *
   * @param {object} params
   * @param {object} params.practice - resolved practice object
   * @param {string} params.message - latest patient message
   * @param {Array<{role: 'user'|'assistant', content: string}>} params.history
   * @param {object} params.slots - accumulated conversation slot memory
   * @returns {Promise<{
   *   language: 'en'|'ur',
   *   intent: string,
   *   entities: object,
   *   reply: string,
   *   suggestedActions: string[],
   * }>}
   */
  // eslint-disable-next-line no-unused-vars
  async understandAndReply({ practice, message, history, slots }) {
    throw new Error('AIProvider.understandAndReply() not implemented');
  }
}

module.exports = AIProvider;
