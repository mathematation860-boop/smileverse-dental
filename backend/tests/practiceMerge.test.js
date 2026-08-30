const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergePracticeConfig } = require('../services/practice/practiceMerge');

const BASE = {
  practiceId: 'smileverse-dental',
  demoMode: true,
  name: 'SmileVerse Dental',
  phone: '+1-555-0000',
  timezone: 'America/New_York',
  hours: { display: '9-5', openDays: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '17:00', slotMinutes: 30 },
  services: [{ id: 'cleaning', name: 'Cleaning', price: 150, duration: 45 }],
  insurance: { acceptedProviders: ['Delta Dental'], notes: 'base notes' },
  cancellationPolicy: { summary: 'base cancellation' },
  emergencyPolicy: { summary: 'base emergency', emergencyServiceId: 'emergency' },
  integrations: { calendarProvider: 'demo' },
  compliance: { hipaaCompliant: false },
};

test('with no overrides, returns an equivalent copy of the base practice', () => {
  const merged = mergePracticeConfig(BASE, null);
  assert.equal(merged.name, 'SmileVerse Dental');
  assert.equal(merged.phone, '+1-555-0000');
  assert.deepEqual(merged.services, BASE.services);
});

test('does not mutate the base practice object', () => {
  const before = JSON.stringify(BASE);
  mergePracticeConfig(BASE, { name: 'New Name', hours: { openTime: '08:00' } });
  assert.equal(JSON.stringify(BASE), before);
});

test('overrides simple fields', () => {
  const merged = mergePracticeConfig(BASE, { name: 'New Clinic Name', phone: '+1-555-9999' });
  assert.equal(merged.name, 'New Clinic Name');
  assert.equal(merged.phone, '+1-555-9999');
});

test('an empty-string override does not blank out an existing value', () => {
  const merged = mergePracticeConfig(BASE, { name: '', phone: '   ' });
  assert.equal(merged.name, 'SmileVerse Dental');
  assert.equal(merged.phone, '+1-555-0000');
});

test('hours override merges onto base hours rather than replacing wholesale', () => {
  const merged = mergePracticeConfig(BASE, { hours: { openTime: '08:00' } });
  assert.equal(merged.hours.openTime, '08:00');
  assert.equal(merged.hours.closeTime, '17:00'); // untouched field preserved
});

test('services override replaces the whole list', () => {
  const newServices = [{ id: 'xray', name: 'X-Ray', price: 50, duration: 20 }];
  const merged = mergePracticeConfig(BASE, { services: newServices });
  assert.deepEqual(merged.services, newServices);
});

test('policies override sets only the summary text, never emergencyServiceId', () => {
  const merged = mergePracticeConfig(BASE, {
    policies: { cancellationSummary: 'new cancellation text', emergencySummary: 'new emergency text' },
  });
  assert.equal(merged.cancellationPolicy.summary, 'new cancellation text');
  assert.equal(merged.emergencyPolicy.summary, 'new emergency text');
  assert.equal(merged.emergencyPolicy.emergencyServiceId, 'emergency');
});

test('SAFETY: emergencyServiceId cannot be overridden even if explicitly supplied', () => {
  const merged = mergePracticeConfig(BASE, {
    policies: { emergencySummary: 'x' },
    emergencyPolicy: { emergencyServiceId: 'not-a-real-service' },
  });
  assert.equal(merged.emergencyPolicy.emergencyServiceId, 'emergency');
});

test('INVARIANTS: demoMode, integrations, compliance, practiceId always come from base', () => {
  const merged = mergePracticeConfig(BASE, {
    demoMode: false,
    integrations: { calendarProvider: 'google' },
    compliance: { hipaaCompliant: true },
    practiceId: 'someone-elses-practice',
  });
  assert.equal(merged.demoMode, true);
  assert.deepEqual(merged.integrations, { calendarProvider: 'demo' });
  assert.deepEqual(merged.compliance, { hipaaCompliant: false });
  assert.equal(merged.practiceId, 'smileverse-dental');
});

test('aiConfig.customInstructions defaults to empty string when not set', () => {
  const merged = mergePracticeConfig(BASE, {});
  assert.equal(merged.aiConfig.customInstructions, '');
});

test('aiConfig.customInstructions is carried through when set', () => {
  const merged = mergePracticeConfig(BASE, { aiConfig: { customInstructions: 'Mention our new hygienist.' } });
  assert.equal(merged.aiConfig.customInstructions, 'Mention our new hygienist.');
});
