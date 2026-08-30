/**
 * Tests the pure response-parsing logic in GeminiAIProvider.js — the part
 * that turns the model's raw JSON text into this app's structured result.
 * No network/SDK call is made or mocked here on purpose: `parseModelResponse`
 * takes a plain string (exactly what `result.response.text()` would give
 * the real provider) and is fully deterministic, so real-AI-shaped inputs
 * can be exercised directly without a live Gemini key or an SDK mock.
 *
 * "Real AI success" here means: given a well-formed response in the exact
 * shape Gemini's structured-output mode is configured to always return
 * (see buildResponseSchema in GeminiAIProvider.js), the provider produces
 * a correct structured result. It intentionally does NOT prove the live
 * Gemini API itself returns good answers for a given practice/prompt —
 * that can only be verified with a real GEMINI_API_KEY, which this sandbox
 * does not have (see the Phase 1 report's "still needs verification" note).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseModelResponse,
  findPriceMismatch,
  slotsToKnownInfoBlock,
} = require('../services/ai/GeminiAIProvider');
const practice = require('../config/practices/smileverse-dental');

function modelSaid(obj) {
  return JSON.stringify(obj);
}

test('real AI success: well-formed structured response is parsed correctly', () => {
  const raw = modelSaid({
    language: 'en',
    intent: 'pricing',
    entities: { serviceId: 'cleaning', datePreference: 'none', patientType: 'new', urgency: 'none', insuranceProvider: 'none' },
    reply: 'A routine cleaning is $150 and takes about 45 minutes.',
    suggestedActions: ['book_appointment'],
  });

  const result = parseModelResponse(raw, practice);

  assert.equal(result.language, 'en');
  assert.equal(result.intent, 'pricing');
  assert.equal(result.entities.serviceId, 'cleaning');
  assert.equal(result.entities.datePreference, null); // 'none' sentinel -> null
  assert.equal(result.reply, 'A routine cleaning is $150 and takes about 45 minutes.');
  assert.deepEqual(result.suggestedActions, ['book_appointment']);
});

test('AI failure fallback: unparseable model output never crashes the request', () => {
  const result = parseModelResponse('not valid json at all {{{', practice);
  assert.equal(result.intent, 'general');
  assert.equal(result.entities.serviceId, null);
  assert.match(result.reply, /rephrase/i);
  assert.deepEqual(result.suggestedActions, ['none']);
});

test('AI failure fallback: an unknown/invalid intent value degrades to general rather than crashing', () => {
  const raw = modelSaid({
    language: 'en',
    intent: 'not_a_real_intent',
    entities: { serviceId: 'none', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    reply: 'Sure, happy to help.',
    suggestedActions: ['none'],
  });
  const result = parseModelResponse(raw, practice);
  assert.equal(result.intent, 'general');
});

test('price-hallucination guard: a $ amount matching a real configured price passes through unchanged', () => {
  const raw = modelSaid({
    language: 'en',
    intent: 'pricing',
    entities: { serviceId: 'crown', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    reply: 'A crown is $1200 and takes about 2 hours.',
    suggestedActions: ['book_appointment'],
  });
  const result = parseModelResponse(raw, practice);
  assert.equal(result.reply, 'A crown is $1200 and takes about 2 hours.');
});

test('price-hallucination guard: a $ amount NOT matching any configured price is replaced with a safe fallback', () => {
  const raw = modelSaid({
    language: 'en',
    intent: 'pricing',
    entities: { serviceId: 'crown', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    // 1200 is the real crown price; 999 is not any configured price — a
    // hallucinated/fabricated number that must never reach the patient.
    reply: 'A crown is only $999 today as a special offer!',
    suggestedActions: ['book_appointment'],
  });
  const result = parseModelResponse(raw, practice);
  assert.notEqual(result.reply, 'A crown is only $999 today as a special offer!');
  assert.match(result.reply, /double-check|Prices section/i);
  assert.deepEqual(result.suggestedActions, ['show_prices']);
  // The structured intent/entities (constrained by the JSON schema's own
  // enums) are still trusted — only the free-text reply is swapped out.
  assert.equal(result.intent, 'pricing');
  assert.equal(result.entities.serviceId, 'crown');
});

test('price-hallucination guard: findPriceMismatch is null when every $ amount is real', () => {
  assert.equal(findPriceMismatch('Cleaning is $150, whitening is $200.', practice), null);
});

test('price-hallucination guard: findPriceMismatch flags the first amount with no matching configured price', () => {
  const mismatch = findPriceMismatch('That would be around $75 for a quick look.', practice);
  assert.ok(mismatch);
  assert.match(mismatch, /\$\s?75/);
});

test('Urdu: language classified as ur is preserved and the fallback for that language is in Urdu script', () => {
  const raw = modelSaid({
    language: 'ur',
    intent: 'hours',
    entities: { serviceId: 'none', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    reply: 'ہمارے اوقات کار پیر سے جمعہ، صبح 9 بجے سے شام 5 بجے تک ہیں۔',
    suggestedActions: ['none'],
  });
  const result = parseModelResponse(raw, practice);
  assert.equal(result.language, 'ur');
  assert.equal(result.reply, 'ہمارے اوقات کار پیر سے جمعہ، صبح 9 بجے سے شام 5 بجے تک ہیں۔');
});

test('Urdu: price-guard fallback text is also localized when language is ur', () => {
  const raw = modelSaid({
    language: 'ur',
    intent: 'pricing',
    entities: { serviceId: 'crown', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    reply: 'کراؤن کی قیمت صرف $999 ہے۔',
    suggestedActions: ['book_appointment'],
  });
  const result = parseModelResponse(raw, practice);
  assert.notEqual(result.reply, 'کراؤن کی قیمت صرف $999 ہے۔');
  // The Urdu fallback string, not the English one.
  assert.match(result.reply, /Prices/); // "Prices" section name is left in English on purpose (matches the UI label)
  assert.ok(/[؀-ۿ]/.test(result.reply), 'expected Urdu-script characters in the localized fallback');
});

test('Roman Urdu: a reply written in Roman-script Urdu is passed through untouched (not mangled or rejected)', () => {
  // The structured-output schema only has an 'en'/'ur' language enum (no
  // separate "roman-ur" value) — a patient writing in Roman Urdu is
  // expected to get language:'ur' back with the reply itself still in
  // Roman script, since `reply` is freeform text, not constrained to a
  // particular script. This test proves our parsing code does not
  // mis-detect, corrupt, or reject that shape; it does not (and cannot,
  // without a real Gemini key) prove the live model actually classifies
  // Roman Urdu input this way — that needs live verification.
  const raw = modelSaid({
    language: 'ur',
    intent: 'book_appointment',
    entities: { serviceId: 'cleaning', datePreference: 'tomorrow', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
    reply: 'Bilkul, cleaning kal ke liye book kar dete hain. Kya waqt aap ko theek rahega?',
    suggestedActions: ['book_appointment'],
  });
  const result = parseModelResponse(raw, practice);
  assert.equal(result.language, 'ur');
  assert.equal(result.reply, 'Bilkul, cleaning kal ke liye book kar dete hain. Kya waqt aap ko theek rahega?');
  assert.equal(result.entities.serviceId, 'cleaning');
  assert.equal(result.entities.datePreference, 'tomorrow');
});

test('unknown information: an insurance provider entity outside the practice list is preserved, not silently dropped or invented', () => {
  // The model is instructed (see promptBuilder.js) to say it cannot
  // confirm coverage for a provider not on the accepted list rather than
  // guessing — this test confirms the parsing layer carries whatever
  // provider name the model extracted through as-is (so the route/UI can
  // decide what to do with it; parseModelResponse itself never validates
  // or invents insurance facts, that job belongs to insuranceService, see
  // insuranceService.test.js "reports unknown for an unlisted provider").
  const raw = modelSaid({
    language: 'en',
    intent: 'insurance',
    entities: { serviceId: 'none', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'SomeRandomInsuranceCo' },
    reply: "I don't have enough information to confirm that provider — I can connect you with our front desk to check.",
    suggestedActions: ['talk_to_human'],
  });
  const result = parseModelResponse(raw, practice);
  assert.equal(result.entities.insuranceProvider, 'SomeRandomInsuranceCo');
  assert.match(result.reply, /don't have enough information/i);
});

test('conversation context: slotsToKnownInfoBlock carries forward what was already said instead of re-asking', () => {
  const slots = { serviceId: 'cleaning', datePreference: 'tomorrow', patientType: null, name: null, phone: null };
  const block = slotsToKnownInfoBlock(practice, slots);
  assert.match(block, /Service already discussed: Cleaning/);
  assert.match(block, /Date preference already given: tomorrow/);
  assert.doesNotMatch(block, /Patient type already given/);
});

test('conversation context: with nothing known yet, the block says so explicitly rather than fabricating context', () => {
  const block = slotsToKnownInfoBlock(practice, { serviceId: null, datePreference: null, patientType: null, name: null, phone: null });
  assert.equal(block, 'Known information so far: none yet.');
});
