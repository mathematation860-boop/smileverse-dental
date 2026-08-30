/**
 * Light coverage of the receptionist tools layer — only the read-only,
 * non-DB-dependent tools (get_practice_info, get_services, etc). The
 * side-effecting tools (create_appointment, request_human_handoff, ...)
 * need a real MongoDB connection and are exercised instead by the manual
 * Playwright smoke tests documented in the final report, since this repo
 * has no in-memory MongoDB available for automated testing.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const tools = require('../tools/receptionistTools');
const practice = require('../config/practices/smileverse-dental');

test('get_practice_info exposes only safe, expected fields (no internal config leaks)', () => {
  const info = tools.get_practice_info(practice);
  assert.equal(info.practiceId, 'smileverse-dental');
  assert.equal(info.name, 'SmileVerse Dental');
  assert.equal(info.demoMode, true);
  assert.equal(info.timezone, 'America/New_York');
  // Must not leak internal integration config to callers.
  assert.equal(info.integrations, undefined);
  assert.equal(info.insurance, undefined);
});

test('get_services returns the full configured service list', () => {
  const services = tools.get_services(practice);
  assert.ok(Array.isArray(services));
  assert.ok(services.find((s) => s.id === 'cleaning'));
  assert.ok(services.find((s) => s.id === 'emergency'));
});

test('get_service_details finds a known service and returns null for an unknown id', () => {
  const cleaning = tools.get_service_details(practice, 'cleaning');
  assert.equal(cleaning.name, 'Cleaning');

  const missing = tools.get_service_details(practice, 'does_not_exist');
  assert.equal(missing, null);
});

test('get_hours returns the configured business hours object', () => {
  const hours = tools.get_hours(practice);
  assert.deepEqual(hours.openDays, [1, 2, 3, 4, 5]);
  assert.equal(hours.openTime, '09:00');
});

test('get_location returns address and timezone only', () => {
  const location = tools.get_location(practice);
  assert.equal(location.address, practice.address);
  assert.equal(location.timezone, 'America/New_York');
});

test('get_insurance_information with no provider lists all accepted providers', () => {
  const result = tools.get_insurance_information(practice);
  assert.ok(Array.isArray(result.acceptedProviders));
  assert.ok(result.acceptedProviders.length > 0);
});

test('get_insurance_information with a provider name checks it deterministically', () => {
  const [known] = practice.insurance.acceptedProviders;
  const result = tools.get_insurance_information(practice, known);
  assert.equal(result.status, 'accepted');
});
