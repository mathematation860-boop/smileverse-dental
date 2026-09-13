/**
 * Price guard: what a patient may be told a treatment costs.
 *
 * Each case below is a reply the OLD guard let through to a patient —
 * a real price promise the clinic would have had to honour or retract.
 * The guard is one-directional by design, so the last group also pins
 * down that correct replies still pass unchanged: a guard that blocked
 * everything would be "safe" and useless.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findPriceMismatch, inspectPrices } = require('../services/ai/priceGuard');

const practice = {
  services: [
    { id: 'cleaning', name: 'Cleaning', price: 150 },
    { id: 'root_canal', name: 'Root Canal', price: 800 },
    { id: 'whitening', name: 'Whitening', price: 200 },
    { id: 'crown', name: 'Crown', price: 1200 },
    { id: 'consultation', name: 'Consultation', price: 0 },
    { id: 'emergency', name: 'Emergency Visit', price: null },
  ],
};

test('a real price quoted against the WRONG treatment is caught', () => {
  // $150 is a real configured price — the cleaning price. Attached to a
  // root canal it is a £650 error the patient would reasonably hold the
  // clinic to.
  const found = inspectPrices('A root canal is $150.', practice);
  assert.ok(found, 'the old guard accepted this because 150 appears somewhere in the price list');
  assert.equal(found.reason, 'wrong_service_price');
  assert.equal(found.service, 'Root Canal');
  assert.equal(found.expected, 800);
});

test('the correct price for the named treatment passes', () => {
  assert.equal(findPriceMismatch('A root canal is $800.', practice), null);
});

test('cents are not silently dropped', () => {
  assert.ok(findPriceMismatch('A cleaning is $150.99.', practice), '"$150.99" must not be accepted as "$150"');
  assert.equal(findPriceMismatch('A cleaning is $150.00.', practice), null);
});

test('a price written in another currency is refused rather than converted', () => {
  const found = inspectPrices('A cleaning is 150 PKR.', practice);
  assert.ok(found);
  assert.equal(found.reason, 'foreign_currency');
  assert.ok(findPriceMismatch('A cleaning is €150.', practice));
  assert.ok(findPriceMismatch('A cleaning costs 150 euros.', practice));
});

test('a treatment with no configured price justifies no amount at all', () => {
  const found = inspectPrices('An Emergency Visit is $300.', practice);
  assert.ok(found);
  assert.equal(found.reason, 'service_has_no_price');
  assert.equal(found.service, 'Emergency Visit');
});

test('an amount matching no configured price is still caught', () => {
  const found = inspectPrices('That would be around $75 for a quick look.', practice);
  assert.ok(found);
  assert.equal(found.reason, 'unknown_amount');
});

test('a thousands separator is read as one number, not flagged as invented', () => {
  // The old regex matched only the leading '$1' of '$1,200' and rejected a
  // correctly written crown price.
  assert.equal(findPriceMismatch('A Crown is $1,200.', practice), null);
  assert.ok(findPriceMismatch('A Crown is $1,300.', practice));
});

test('a free service can be quoted as free', () => {
  assert.equal(findPriceMismatch('A Consultation is $0 — no charge.', practice), null);
});

test('several treatments in one sentence are each allowed their own real price', () => {
  assert.equal(findPriceMismatch('Cleaning is $150, whitening is $200.', practice), null);
});

test('"dollars" spelled out is checked, not ignored', () => {
  assert.equal(findPriceMismatch('A cleaning is 150 dollars.', practice), null);
  assert.ok(findPriceMismatch('A cleaning is 175 dollars.', practice));
});

test('a reply with no prices in it is left alone', () => {
  assert.equal(findPriceMismatch('We are open Monday to Friday, 9 to 5.', practice), null);
  assert.equal(findPriceMismatch('A crown takes about 2 hours across 2 visits.', practice), null);
});

test('the wrong price is caught across sentences, not only the first', () => {
  const found = inspectPrices('We are open 9 to 5. A Whitening is $800.', practice);
  assert.ok(found);
  assert.equal(found.service, 'Whitening');
  assert.equal(found.expected, 200);
});
