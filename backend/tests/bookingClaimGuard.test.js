/**
 * The assistant must never announce a booking.
 *
 * In this architecture the model cannot book anything — only the
 * deterministic REST layer can — so any reply stating that a booking has
 * happened is false by construction. Until now the only thing preventing
 * it was a line in the system prompt, which is a request to the model
 * rather than a control over it. These tests pin down the control.
 *
 * The second group matters as much as the first: a guard that suppressed
 * every mention of booking would make the receptionist useless, and
 * offering to book is exactly what it should do.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findBookingClaim, bookingClaimFallback } = require('../services/ai/bookingClaimGuard');
const { parseModelResponse } = require('../services/ai/GeminiAIProvider');

const practice = {
  services: [
    { id: 'cleaning', name: 'Cleaning', price: 150 },
    { id: 'crown', name: 'Crown', price: 1200 },
  ],
};

function modelSaid(payload) {
  return JSON.stringify(payload);
}

function reply(text, language = 'en') {
  return parseModelResponse(
    modelSaid({
      language,
      intent: 'booking',
      entities: { serviceId: 'none', datePreference: 'none', patientType: 'none', urgency: 'none', insuranceProvider: 'none' },
      reply: text,
      suggestedActions: ['book_appointment'],
    }),
    practice
  );
}

// --- claims that must never reach a patient ---

const FALSE_CLAIMS = [
  "You're all booked for Tuesday at 10am.",
  "I've booked you in for a cleaning on Thursday.",
  'I have scheduled your appointment for 3pm.',
  'Your appointment is confirmed for Monday morning.',
  'Your booking has been confirmed — see you then.',
  "I've put you down for 2pm on Friday.",
  "That's booked. Anything else I can help with?",
  'Great, your appointment has been scheduled.',
  'We�ll see you on Tuesday!'.replace('�', "'"),
  'You now have an appointment on 14 October.',
  "I've gone ahead and reserved that slot for you.",
];

for (const claim of FALSE_CLAIMS) {
  test(`a reply claiming a completed booking is caught: "${claim.slice(0, 42)}…"`, () => {
    assert.ok(findBookingClaim(claim), 'the model must not be able to announce a booking');
  });
}

test('a caught claim is REPLACED before the patient sees it', () => {
  const result = reply("You're all booked for Tuesday at 10am.");
  assert.notEqual(result.reply, "You're all booked for Tuesday at 10am.");
  assert.match(result.reply, /can't book an appointment myself/i);
  assert.deepEqual(result.suggestedActions, ['book_appointment'], 'and the patient is pointed at the thing that can book');
});

test('the replacement is localised when the model answered in Urdu', () => {
  const result = reply('آپ کی اپائنٹمنٹ کنفرم ہو گئی ہے۔', 'ur');
  assert.equal(result.language, 'ur');
  assert.equal(result.reply, bookingClaimFallback('ur'));
});

test('a common Urdu affirmative is caught', () => {
  assert.ok(findBookingClaim('آپ کی اپائنٹمنٹ بک ہو گئی ہے'));
});

// --- what the receptionist SHOULD still be able to say ---

const LEGITIMATE = [
  'I can book that for you — would Tuesday at 10am work?',
  'Would you like me to hold 2pm on Thursday?',
  'To book an appointment, use the booking form and pick a time that suits you.',
  'We have 10am and 2pm free on Tuesday. Which would you prefer?',
  'A cleaning is $150 and takes about 30 minutes.',
  'You can book online, or call the front desk on +1-555-0100.',
  'Our hours are 9 to 5, Monday to Friday.',
  'I can check what times are available if you tell me the day.',
];

for (const line of LEGITIMATE) {
  test(`a legitimate reply passes untouched: "${line.slice(0, 42)}…"`, () => {
    assert.equal(findBookingClaim(line), null, 'offering to book is exactly what the assistant should do');
  });
}

test('an offer to book survives the full parse unchanged', () => {
  const text = 'I can book that for you — would Tuesday at 10am work?';
  assert.equal(reply(text).reply, text);
});

test('both guards can fire on one reply, and the booking claim wins the message', () => {
  // A reply that invents a price AND claims a booking. Either alone would
  // be replaced; together the patient must not be left with the booking
  // claim just because the price guard ran first.
  const result = reply("A cleaning is $77 and you're all booked for Tuesday.");
  assert.doesNotMatch(result.reply, /\$77/);
  assert.doesNotMatch(result.reply, /all booked/i);
  assert.match(result.reply, /can't book an appointment myself/i);
});

test('an empty or missing reply is not treated as a claim', () => {
  assert.equal(findBookingClaim(''), null);
  assert.equal(findBookingClaim(null), null);
  assert.equal(findBookingClaim(undefined), null);
});
