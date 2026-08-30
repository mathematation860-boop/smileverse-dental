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

test('Phase 5: notifications.smsEnabled/emailEnabled/reminderOffsetsHours are overridable', () => {
  const base = { ...BASE, notifications: { smsEnabled: true, emailEnabled: true, reminderOffsetsHours: [24], smsPhoneNumber: '+15550001111', clinicAlertPhone: null, clinicAlertEmail: null } };
  const merged = mergePracticeConfig(base, { notifications: { smsEnabled: false, reminderOffsetsHours: [48, 2] } });
  assert.equal(merged.notifications.smsEnabled, false);
  assert.equal(merged.notifications.emailEnabled, true, 'an untouched field keeps its base value');
  assert.deepEqual(merged.notifications.reminderOffsetsHours, [48, 2]);
});

test('SAFETY: notifications.smsPhoneNumber/clinicAlertPhone/clinicAlertEmail can never be overridden', () => {
  const base = { ...BASE, notifications: { smsEnabled: true, emailEnabled: true, reminderOffsetsHours: [24], smsPhoneNumber: '+15550001111', clinicAlertPhone: '+15559990000', clinicAlertEmail: 'clinic@base.example' } };
  const merged = mergePracticeConfig(base, {
    notifications: {
      smsPhoneNumber: '+19995551234',
      clinicAlertPhone: '+19995559999',
      clinicAlertEmail: 'attacker@example.com',
    },
  });
  assert.equal(merged.notifications.smsPhoneNumber, '+15550001111');
  assert.equal(merged.notifications.clinicAlertPhone, '+15559990000');
  assert.equal(merged.notifications.clinicAlertEmail, 'clinic@base.example');
});

test('an invalid reminderOffsetsHours override is ignored, falling back to the base value', () => {
  const base = { ...BASE, notifications: { smsEnabled: true, emailEnabled: true, reminderOffsetsHours: [24] } };
  const merged = mergePracticeConfig(base, { notifications: { reminderOffsetsHours: 'not-an-array' } });
  assert.deepEqual(merged.notifications.reminderOffsetsHours, [24]);
});

// --- Phase 6: pms.{serviceMappings,providerMappings,operatoryMappings}
// are overridable ID-mapping config; pms.openDental (apiBaseUrl/clinicNum)
// is a base-config/env-only invariant, same reasoning as
// notifications.smsPhoneNumber and voice.phoneNumber above.

test('Phase 6: pms.serviceMappings/providerMappings/operatoryMappings are overridable', () => {
  const base = { ...BASE, pms: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {}, openDental: { apiBaseUrl: 'https://api.opendental.com/api/v1', clinicNum: 0 } } };
  const merged = mergePracticeConfig(base, {
    pms: {
      serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '12' } },
      providerMappings: { default: { openDentalProvNum: '3' } },
      operatoryMappings: { default: { openDentalOpNum: '7' } },
    },
  });
  assert.deepEqual(merged.pms.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '12' } });
  assert.deepEqual(merged.pms.providerMappings, { default: { openDentalProvNum: '3' } });
  assert.deepEqual(merged.pms.operatoryMappings, { default: { openDentalOpNum: '7' } });
});

test('Phase 6: an untouched pms mapping group keeps its base value when only one group is overridden', () => {
  const base = { ...BASE, pms: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '1' } }, providerMappings: { default: { openDentalProvNum: '9' } }, operatoryMappings: {}, openDental: {} } };
  const merged = mergePracticeConfig(base, { pms: { operatoryMappings: { default: { openDentalOpNum: '2' } } } });
  assert.deepEqual(merged.pms.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '1' } });
  assert.deepEqual(merged.pms.providerMappings, { default: { openDentalProvNum: '9' } });
  assert.deepEqual(merged.pms.operatoryMappings, { default: { openDentalOpNum: '2' } });
});

test('SAFETY: pms.openDental (apiBaseUrl/clinicNum) can never be overridden from the dashboard', () => {
  const base = { ...BASE, pms: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {}, openDental: { apiBaseUrl: 'https://api.opendental.com/api/v1', clinicNum: 0 } } };
  const merged = mergePracticeConfig(base, {
    pms: { openDental: { apiBaseUrl: 'https://attacker.example.com', clinicNum: 999 } },
  });
  assert.deepEqual(merged.pms.openDental, { apiBaseUrl: 'https://api.opendental.com/api/v1', clinicNum: 0 });
});

test('Phase 6: a malformed pms override (non-object, or non-object mapping groups) is ignored, falling back to base values', () => {
  const base = { ...BASE, pms: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '1' } }, providerMappings: {}, operatoryMappings: {}, openDental: {} } };
  const merged1 = mergePracticeConfig(base, { pms: 'not-an-object' });
  assert.deepEqual(merged1.pms.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '1' } });

  const merged2 = mergePracticeConfig(base, { pms: { serviceMappings: 'also-not-an-object' } });
  assert.deepEqual(merged2.pms.serviceMappings, { cleaning: { openDentalAppointmentTypeNum: '1' } });
});

test('INVARIANTS (Phase 6): a pmsProvider selector hidden inside integrations still can never be overridden via the pms key', () => {
  const base = { ...BASE, integrations: { calendarProvider: 'demo', pmsProvider: 'openDental' }, pms: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {}, openDental: {} } };
  const merged = mergePracticeConfig(base, { integrations: { pmsProvider: 'none' } });
  assert.equal(merged.integrations.pmsProvider, 'openDental', 'integrations stays a base-config-only invariant, exactly like demoMode/compliance/practiceId');
});
