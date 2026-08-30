/**
 * AI provider factory. Reads `practice.integrations.aiProvider` so
 * different practices could eventually run on different AI vendors — for
 * now only 'gemini' is implemented, and everything falls back to it.
 */

const GeminiAIProvider = require('./GeminiAIProvider');

let geminiInstance = null;

function getAIProvider(practice) {
  const providerName = practice?.integrations?.aiProvider || 'gemini';

  switch (providerName) {
    case 'gemini':
    default:
      if (!geminiInstance) geminiInstance = new GeminiAIProvider();
      return geminiInstance;
  }
}

module.exports = { getAIProvider };
