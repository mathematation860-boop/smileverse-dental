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
 *
 * Testability note: everything that turns the model's raw text into the
 * structured result this provider returns lives in `parseModelResponse`
 * below, a pure function with no network/SDK dependency. Tests exercise
 * that function directly with hand-written "model said X" strings instead
 * of mocking the Gemini SDK, so this file has no test-only seams baked
 * into the class itself.
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

// Used ONLY when the model's own JSON response cannot be parsed at all —
// an AI-provider-level failure, not a normal conversational turn.
const PARSE_FAILURE_REPLY_EN = "Sorry, could you rephrase that? I want to make sure I help with the right thing.";

// Used when the model's reply text mentions a dollar amount that does not
// match any price actually configured for this practice — a possible
// hallucination. We never let a fabricated price reach the patient; the
// structured intent/entities are still trusted (they're constrained by
// the JSON schema's enums), only the free-text `reply` is swapped out.
const PRICE_GUARD_FALLBACK_EN =
  "I want to double-check that price rather than guess — you can see our full, current price list in the Prices section, " +
  'or I can connect you with our front desk to confirm.';
const PRICE_GUARD_FALLBACK_UR =
  'میں اندازہ لگانے کے بجائے قیمت دوبارہ چیک کرنا چاہوں گا — آپ Prices سیکشن میں ہماری مکمل، موجودہ قیمتوں کی فہرست دیکھ سکتے ہیں، ' +
  'یا میں آپ کو تصدیق کے لیے ہمارے فرنٹ ڈیسک سے ملوا سکتا ہوں۔';

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

/**
 * Scans free text for "$<number>" mentions and returns the first one that
 * does not match any currently-configured service price for this practice
 * (a likely hallucination), or null if every mentioned amount is real.
 * Intentionally simple/conservative: it only ever narrows what can slip
 * through, never rewrites or "corrects" the model's wording.
 */
function findPriceMismatch(replyText, practice) {
  if (!replyText) return null;
  const validPrices = new Set(
    (practice.services || [])
      .filter((s) => s.price !== null && s.price !== undefined)
      .map((s) => String(s.price))
  );
  const matches = replyText.match(/\$\s?\d+(?:\.\d{1,2})?/g) || [];
  for (const raw of matches) {
    const amount = raw.replace(/[$\s]/g, '').split('.')[0];
    if (!validPrices.has(amount)) return raw;
  }
  return null;
}

/**
 * Pure function: turns the model's raw response text into this provider's
 * structured result shape. No network/SDK calls happen in here, which is
 * what makes it directly unit-testable with hand-written JSON strings.
 */
function parseModelResponse(rawText, practice) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      language: 'en',
      intent: 'general',
      entities: { serviceId: null, datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
      reply: PARSE_FAILURE_REPLY_EN,
      suggestedActions: ['none'],
    };
  }

  const language = parsed.language === 'ur' ? 'ur' : 'en';
  const intent = INTENTS.includes(parsed.intent) ? parsed.intent : 'general';
  const entities = {
    serviceId: sentinelToNull(parsed.entities?.serviceId),
    datePreference: sentinelToNull(parsed.entities?.datePreference),
    patientType: sentinelToNull(parsed.entities?.patientType),
    urgency: parsed.entities?.urgency || 'none',
    insuranceProvider: sentinelToNull(parsed.entities?.insuranceProvider),
  };
  let reply = parsed.reply || "I'm here to help — could you tell me a bit more?";
  let suggestedActions = Array.isArray(parsed.suggestedActions) && parsed.suggestedActions.length
    ? parsed.suggestedActions
    : ['none'];

  const mismatch = findPriceMismatch(reply, practice);
  if (mismatch) {
    reply = language === 'ur' ? PRICE_GUARD_FALLBACK_UR : PRICE_GUARD_FALLBACK_EN;
    suggestedActions = ['show_prices'];
  }

  return { language, intent, entities, reply, suggestedActions };
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

    return parseModelResponse(raw, practice);
  }
}

module.exports = GeminiAIProvider;
module.exports.INTENTS = INTENTS;
module.exports.SUGGESTED_ACTIONS = SUGGESTED_ACTIONS;
module.exports.parseModelResponse = parseModelResponse;
module.exports.findPriceMismatch = findPriceMismatch;
module.exports.slotsToKnownInfoBlock = slotsToKnownInfoBlock;
