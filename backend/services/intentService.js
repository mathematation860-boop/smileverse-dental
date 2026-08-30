/**
 * Conversation understanding + reply generation.
 *
 * This is the "CONVERSATION -> UNDERSTANDING -> ACTION" layer that makes
 * this feel like a real receptionist instead of a generic chatbot: every
 * patient message is classified into an intent + a set of extracted
 * entities (service, date preference, urgency, patient type, insurance
 * provider) using Gemini's structured JSON output, merged with what we
 * already know about this conversation, and only THEN turned into a
 * natural-language reply plus a set of suggested UI actions.
 *
 * Routes/components act on `intent` + `entities` (e.g. to open the
 * booking flow already pre-filled, or to show the emergency button) —
 * they never have to re-parse free text themselves.
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const practiceConfig = require('../config/practiceConfig');
const { buildSystemInstruction } = require('../config/promptBuilder');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

const SERVICE_IDS = practiceConfig.services.map((s) => s.id);

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

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    language: { type: SchemaType.STRING, enum: ['en', 'ur'], format: 'enum' },
    intent: { type: SchemaType.STRING, enum: INTENTS, format: 'enum' },
    entities: {
      type: SchemaType.OBJECT,
      properties: {
        serviceId: { type: SchemaType.STRING, enum: [...SERVICE_IDS, 'none'], format: 'enum' },
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

function slotsToKnownInfoBlock(slots) {
  const known = [];
  if (slots.serviceId) {
    const svc = practiceConfig.services.find((s) => s.id === slots.serviceId);
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

/**
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.message - latest patient message
 * @param {Array<{role:string, content:string}>} params.history - prior turns (excluding this message)
 * @param {object} params.slots - accumulated conversation slots from conversationStore
 */
async function understandAndReply({ message, history, slots }) {
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: buildSystemInstruction(),
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
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

  const prompt = `${slotsToKnownInfoBlock(slots)}\n\nPatient message: ${message}`;
  const result = await chat.sendMessage(prompt);
  const raw = result.response.text();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Fall back to a safe, generic reply if the model ever returns malformed JSON.
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

module.exports = { understandAndReply, INTENTS, SUGGESTED_ACTIONS };
