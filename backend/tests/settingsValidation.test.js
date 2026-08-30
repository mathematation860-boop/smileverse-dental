const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateSettingsPatch, validateAiConfigPatch, validateNotificationSettingsPatch, validatePmsSettingsPatch, stripHtml } = require('../services/practice/settingsValidation');

test('stripHtml removes tags but keeps text content', () => {
  assert.equal(stripHtml('<b>Hello</b> <script>alert(1)</script>world'), 'Hello alert(1)world');
});

test('accepts a valid simple patch', () => {
  const result = validateSettingsPatch({ name: 'New Name', phone: '+1-555-1111' });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.name, 'New Name');
});

test('rejects a <script> payload in a free-text field', () => {
  const result = validateSettingsPatch({ name: '<script>alert(1)</script>' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('rejects a javascript: URL', () => {
  const result = validateSettingsPatch({ website: 'javascript:alert(1)' });
  assert.equal(result.valid, false);
});

test('rejects an onerror= handler payload', () => {
  const result = validateSettingsPatch({ address: '<img src=x onerror=alert(1)>' });
  assert.equal(result.valid, false);
});

test('strips ordinary HTML tags from address without rejecting', () => {
  const result = validateSettingsPatch({ address: '<div>123 Main St</div>' });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.address, '123 Main St');
});

test('rejects a name over the max length', () => {
  const result = validateSettingsPatch({ name: 'x'.repeat(500) });
  assert.equal(result.valid, false);
});

test('rejects an invalid timezone', () => {
  const result = validateSettingsPatch({ timezone: 'Not/A_Real_Zone' });
  assert.equal(result.valid, false);
});

test('accepts a valid IANA timezone', () => {
  const result = validateSettingsPatch({ timezone: 'Asia/Karachi' });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.timezone, 'Asia/Karachi');
});

test('rejects business hours where openTime is after closeTime', () => {
  const result = validateSettingsPatch({ hours: { openTime: '18:00', closeTime: '09:00' } });
  assert.equal(result.valid, false);
});

test('accepts valid business hours', () => {
  const result = validateSettingsPatch({ hours: { openTime: '09:00', closeTime: '17:00', slotMinutes: 30, openDays: [1, 2, 3] } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized.hours.openDays, [1, 2, 3]);
});

test('rejects openDays outside 0-6', () => {
  const result = validateSettingsPatch({ hours: { openDays: [1, 9] } });
  assert.equal(result.valid, false);
});

test('rejects a service with a negative price', () => {
  const result = validateSettingsPatch({ services: [{ id: 'x', name: 'X-Ray', price: -5, duration: 20 }] });
  assert.equal(result.valid, false);
});

test('rejects a service with a non-integer duration outside range', () => {
  const result = validateSettingsPatch({ services: [{ id: 'x', name: 'X-Ray', price: 10, duration: 1000 }] });
  assert.equal(result.valid, false);
});

test('accepts a service with a null price (e.g. "priced after evaluation")', () => {
  const result = validateSettingsPatch({ services: [{ id: 'emergency', name: 'Emergency', price: null, duration: 30 }] });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.services[0].price, null);
});

test('rejects insurance.acceptedProviders that is not an array of strings', () => {
  const result = validateSettingsPatch({ insurance: { acceptedProviders: 'Delta Dental' } });
  assert.equal(result.valid, false);
});

test('accepts valid insurance override', () => {
  const result = validateSettingsPatch({ insurance: { acceptedProviders: ['Cigna'], notes: 'Some notes' } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized.insurance.acceptedProviders, ['Cigna']);
});

test('validateAiConfigPatch strips HTML and rejects scripts', () => {
  const ok = validateAiConfigPatch({ customInstructions: 'Mention our new hygienist <b>Sam</b>.' });
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitized.customInstructions, 'Mention our new hygienist Sam.');

  const bad = validateAiConfigPatch({ customInstructions: '<script>doEvil()</script>' });
  assert.equal(bad.valid, false);
});

test('validateAiConfigPatch never accepts a field shaped like a safety toggle', () => {
  // The schema only ever reads `customInstructions` — any other key is
  // simply ignored, so there is no way to pass an "emergencyOverride" flag
  // through this endpoint even if a client tried.
  const result = validateAiConfigPatch({ customInstructions: 'fine', disableEmergencyDetection: true });
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.sanitized).length, 1);
  assert.equal(result.sanitized.disableEmergencyDetection, undefined);
});

test('validateNotificationSettingsPatch accepts a valid patch (spec §9/§19)', () => {
  const result = validateNotificationSettingsPatch({ smsEnabled: false, emailEnabled: true, reminderOffsetsHours: [48, 24, 2] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized, { smsEnabled: false, emailEnabled: true, reminderOffsetsHours: [48, 24, 2] });
});

test('validateNotificationSettingsPatch rejects a non-boolean channel toggle', () => {
  const result = validateNotificationSettingsPatch({ smsEnabled: 'yes' });
  assert.equal(result.valid, false);
});

test('validateNotificationSettingsPatch rejects an empty or oversized reminderOffsetsHours array', () => {
  assert.equal(validateNotificationSettingsPatch({ reminderOffsetsHours: [] }).valid, false);
  assert.equal(validateNotificationSettingsPatch({ reminderOffsetsHours: [1, 2, 3, 4, 5, 6] }).valid, false);
  assert.equal(validateNotificationSettingsPatch({ reminderOffsetsHours: [-5] }).valid, false);
  assert.equal(validateNotificationSettingsPatch({ reminderOffsetsHours: ['not-a-number'] }).valid, false);
});

test('validateNotificationSettingsPatch never accepts a field that could resemble a phone/email destination override', () => {
  // smsPhoneNumber/clinicAlertPhone/clinicAlertEmail must stay base-config-only
  // invariants (see practiceMerge.js) — this endpoint's schema simply never
  // reads them, so passing one through is silently ignored, never persisted.
  const result = validateNotificationSettingsPatch({ smsEnabled: true, smsPhoneNumber: '+15550000000' });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.smsPhoneNumber, undefined);
});

// --- validatePmsSettingsPatch (Phase 6 spec §5/§11/§12/§13/§21) — the
// admin-editable subset of PMS config is ID-mapping-only; API credentials
// are never accepted through this or any other admin endpoint (they come
// only from process.env — see OpenDentalPMSProvider's constructor).

test('validatePmsSettingsPatch accepts a valid set of service/provider/operatory mappings', () => {
  const result = validatePmsSettingsPatch({
    serviceMappings: { cleaning: { openDentalAppointmentTypeNum: 12 } },
    providerMappings: { default: { openDentalProvNum: '3' } },
    operatoryMappings: { default: { openDentalOpNum: 7 } },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '12' } });
  assert.deepEqual(result.sanitized.providerMappings, { default: { openDentalProvNum: '3' } });
  assert.deepEqual(result.sanitized.operatoryMappings, { default: { openDentalOpNum: '7' } });
});

test('validatePmsSettingsPatch accepts a partial patch — omitted mapping groups are simply left out, not zeroed out', () => {
  const result = validatePmsSettingsPatch({ serviceMappings: { whitening: { openDentalAppointmentTypeNum: 4 } } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.sanitized, { serviceMappings: { whitening: { openDentalAppointmentTypeNum: '4' } } });
  assert.equal(result.sanitized.providerMappings, undefined);
});

test('validatePmsSettingsPatch accepts an empty patch (clearing/no-op) and rejects a non-object body', () => {
  assert.equal(validatePmsSettingsPatch({}).valid, true);
  assert.equal(validatePmsSettingsPatch(null).valid, false);
  assert.equal(validatePmsSettingsPatch('nope').valid, false);
});

test('validatePmsSettingsPatch rejects a mapping group that is not an object', () => {
  const result = validatePmsSettingsPatch({ serviceMappings: 'cleaning' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('serviceMappings')));
});

test('validatePmsSettingsPatch rejects an entry missing its required id field, never guessing one', () => {
  const result = validatePmsSettingsPatch({ serviceMappings: { cleaning: { someOtherField: 1 } } });
  assert.equal(result.valid, false);
});

test('validatePmsSettingsPatch rejects an entry whose id field is empty/blank', () => {
  const result = validatePmsSettingsPatch({ providerMappings: { default: { openDentalProvNum: '' } } });
  assert.equal(result.valid, false);
});

test('validatePmsSettingsPatch rejects more than 100 entries in one mapping group', () => {
  const many = {};
  for (let i = 0; i < 101; i += 1) many[`service-${i}`] = { openDentalAppointmentTypeNum: i + 1 };
  const result = validatePmsSettingsPatch({ serviceMappings: many });
  assert.equal(result.valid, false);
});

test('validatePmsSettingsPatch never accepts (or even reads) a credential-shaped field — API keys are process.env-only, never admin-submitted', () => {
  const result = validatePmsSettingsPatch({
    serviceMappings: { cleaning: { openDentalAppointmentTypeNum: 1 } },
    apiKey: 'sneaky-secret',
    developerKey: 'also-sneaky',
    apiBaseUrl: 'https://attacker.example.com',
  });
  assert.equal(result.valid, true);
  assert.equal(result.sanitized.apiKey, undefined);
  assert.equal(result.sanitized.developerKey, undefined);
  assert.equal(result.sanitized.apiBaseUrl, undefined);
});

test('validatePmsSettingsPatch strips HTML/script content out of mapping keys, mirroring stripHtml elsewhere', () => {
  const result = validatePmsSettingsPatch({ serviceMappings: { '<script>alert(1)</script>cleaning': { openDentalAppointmentTypeNum: 1 } } });
  assert.equal(result.valid, true);
  assert.ok(!Object.keys(result.sanitized.serviceMappings).some((k) => k.includes('<script>')));
});
