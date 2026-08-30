/**
 * Google Gemini implementation of AIProvider.
 *
 * This is the "CONVERSATION -> UNDERSTANDING -> ACTION" layer that makes
 * this feel like a real receptionist instead of a generic chatbot: every
 * patient message is classified into an intent + a set of extracted
 * entities (service, date preference, urgency, patient type, insurance
 * provider) using Gemini's structured JSON output, merged with what we
 * already know about this conversation, and only THEN turned into a
 * natural-language reply plus a set of suggested UI actions.
 *
 * Honest limitation: this uses Gemini's structured-output (JSON schema)
 * mode, not native function-calling. The `intent` field IS effectively a
 * tool selection and `entities` its arguments, but the model does not
 * itself invoke backend/tools/receptionistTools.js and get real results
 * back before replying — real actions (checking live availability,
 * actually booking/cancelling) always happen through the deterministic
 * UI flow calling the REST routes/tools directly, never through
 * AI-fabricated data. Moving to native function-calling is the natural
 * next step (see README "Recommended next integration").
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const AIProvider = require('./AIProvider');
const { buildSystemInstruction } = require('../../config/promptBuilder');

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const INTENTS = [
  'faq',
  'pricing',
  'hours',
  'location',
  'book_appointment',
  'reschedule',
  'cancel',
  'emergency',
  'insurance',
  'human_handoff',
  'general',
];

const SUGGESTED_ACTIONS = [
  'book_appointment',
  'urgent_appointment',
  'talk_to_human',
  'show_faq',
  'show_prices',
  'show_insurance',
  'none',
];

function buildResponseSchema(practice) {
  const serviceIds = practice.services.map((s) => s.id);
  return {
    type: SchemaType.OBJECT,
    properties: {
      language: { type: SchemaType.STRING, enum: ['en', 'ur'], format: 'enum' },
      intent: { type: SchemaType.STRING, enum: INTENTS, format: 'enum' },
      entities: {
        type: SchemaType.OBJECT,
        properties: {
          serviceId: { type: SchemaType.STRING, enum: [...serviceIds, 'none'], format: 'enum' },
          datePreference: { type: SchemaType.STRING, description: "Free text like 'tomorrow', 'Friday', or 'none' if not mentioned." },
          patientType: { type: SchemaType.STRING, enum: ['new', 'existing', 'none'], format: 'enum' },
          urgency: { type: SchemaType.STRING, enum: ['none', 'moderate', 'severe', 'life_threatening'], format: 'enum' },
          insuranceProvider: { type: SchemaType.STRING, description: "Provider name mentioned, or 'none'." },
        },
        required: ['serviceId', 'datePreference', 'patientType', 'urgency', 'insuranceProvider'],
      },
      reply: { type: SchemaType.STRING, description: 'The natural-language receptionist reply to show the patient.' },
      suggestedActions: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING, enum: SUGGESTED_ACTIONS, format: 'enum' },
      },
    },
    required: ['language', 'intent', 'entities', 'reply', 'suggestedActions'],
  };
}

function slotsToKnownInfoBlock(practice, slots) {
  const known = [];
  if (slots.serviceId) {
    const svc = practice.services.find((s) => s.id === slots.serviceId);
    if (svc) known.push(`Service already discussed: ${svc.name}`);
  }
  if (slots.datePreference) known.push(`Date preference already given: ${slots.datePreference}`);
  if (slots.patientType) known.push(`Patient type already given: ${slots.patientType}`);
  if (slots.name) known.push(`Name already given: ${slots.name}`);
  if (slots.phone) known.push(`Phone already given: ${slots.phone}`);
  if (known.length === 0) return 'Known information so far: none yet.';
  return `Known information so far (do not ask for these again, carry them forward in your entities output):\n${known.join('\n')}`;
}

function sentinelToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.toLowerCase() === 'none') return null;
  return value;
}

class GeminiAIProvider extends AIProvider {
  constructor(apiKey = process.env.GEMINI_API_KEY) {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async understandAndReply({ practice, message, history, slots }) {
    const model = this.genAI.getGenerativeModel({
      model: MODEL_NAME,
      systemInstruction: buildSystemInstruction(practice),
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: buildResponseSchema(practice),
      },
    });

    const geminiHistory = (history || []).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    while (geminiHistory.length && geminiHistory[0].role !== 'user') {
      geminiHistory.shift();
    }

    const chat = model.startChat({ history: geminiHistory });
    const prompt = `${slotsToKnownInfoBlock(practice, slots)}\n\nPatient message: ${message}`;
    const result = await chat.sendMessage(prompt);
    const raw = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        language: 'en',
        intent: 'general',
        entities: { serviceId: null, datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
        reply: "Sorry, could you rephrase that? I want to make sure I help with the right thing.",
        suggestedActions: ['none'],
      };
    }

    return {
      language: parsed.language === 'ur' ? 'ur' : 'en',
      intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'general',
      entities: {
        serviceId: sentinelToNull(parsed.entities?.serviceId),
        datePreference: sentinelToNull(parsed.entities?.datePreference),
        patientType: sentinelToNull(parsed.entities?.patientType),
        urgency: parsed.entities?.urgency || 'none',
        insuranceProvider: sentinelToNull(parsed.entities?.insuranceProvider),
      },
      reply: parsed.reply || "I'm here to help — could you tell me a bit more?",
      suggestedActions: Array.isArray(parsed.suggestedActions) && parsed.suggestedActions.length
        ? parsed.suggestedActions
        : ['none'],
    };
  }
}

module.exports = GeminiAIProvider;
module.exports.INTENTS = INTENTS;
module.exports.SUGGESTED_ACTIONS = SUGGESTED_ACTIONS;
