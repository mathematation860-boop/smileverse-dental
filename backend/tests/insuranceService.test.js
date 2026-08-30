const { test } = require('node:test');
const assert = require('node:assert/strict');
const insuranceService = require('../services/insuranceService');

const practice = {
  insurance: {
    acceptedProviders: ['Delta Dental', 'Cigna', 'MetLife', 'Aetna'],
    notes: 'Please bring your insurance card to your appointment.',
    notesUr: 'براہ کرم اپنی اپائنٹمنٹ پر اپنا انشورنس کارڈ ساتھ لائیں۔',
  },
};

test('confirms an exact-match accepted provider', () => {
  const result = insuranceService.checkProvider(practice, 'Cigna');
  assert.equal(result.status, 'accepted');
  assert.equal(result.provider, 'Cigna');
  assert.match(result.message, /Cigna/);
});

test('confirms a fuzzy/partial-match accepted provider', () => {
  const result = insuranceService.checkProvider(practice, 'delta');
  assert.equal(result.status, 'accepted');
  assert.equal(result.provider, 'Delta Dental');
});

test('is case- and punctuation-insensitive', () => {
  const result = insuranceService.checkProvider(practice, '  MET-LIFE  ');
  assert.equal(result.status, 'accepted');
  assert.equal(result.provider, 'MetLife');
});

test('reports unknown for an unlisted provider without inventing an answer', () => {
  const result = insuranceService.checkProvider(practice, 'SomeRandomInsuranceCo');
  assert.equal(result.status, 'unknown');
  assert.equal(result.provider, null);
});

test('reports unknown for empty/blank input rather than guessing', () => {
  const result = insuranceService.checkProvider(practice, '   ');
  assert.equal(result.status, 'unknown');
  assert.equal(result.provider, null);
});

test('listAccepted returns the practice configured provider list untouched', () => {
  const result = insuranceService.listAccepted(practice);
  assert.deepEqual(result.acceptedProviders, practice.insurance.acceptedProviders);
  assert.equal(result.notes, practice.insurance.notes);
});
