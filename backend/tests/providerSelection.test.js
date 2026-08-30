/**
 * services/providers/index.js is the ONE place that decides whether a
 * practice's requests are served by the mock provider or a real calendar
 * — Phase 2's "keep demo mode fully functional / only use the real
 * provider in production mode" requirement lives entirely in this
 * switch, so it gets its own focused test file.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getAppointmentProvider } = require('../services/providers');
const DemoAppointmentProvider = require('../services/providers/DemoAppointmentProvider');
const GoogleCalendarAppointmentProvider = require('../services/providers/GoogleCalendarAppointmentProvider');

test('demo mode: demoMode true always uses the mock provider, regardless of integrations.calendarProvider', () => {
  const practice = { demoMode: true, integrations: { calendarProvider: 'google' } };
  assert.ok(getAppointmentProvider(practice) instanceof DemoAppointmentProvider);
});

test('demo mode: demoMode missing/undefined defaults to the safe mock provider (never assume production)', () => {
  const practice = { integrations: { calendarProvider: 'google' } };
  assert.ok(getAppointmentProvider(practice) instanceof DemoAppointmentProvider);
});

test('production mode: demoMode false + calendarProvider google uses the real Google Calendar provider', () => {
  const practice = { demoMode: false, integrations: { calendarProvider: 'google' } };
  assert.ok(getAppointmentProvider(practice) instanceof GoogleCalendarAppointmentProvider);
});

test('production mode: demoMode false + calendarProvider demo (or unset) still uses the mock provider', () => {
  assert.ok(getAppointmentProvider({ demoMode: false, integrations: { calendarProvider: 'demo' } }) instanceof DemoAppointmentProvider);
  assert.ok(getAppointmentProvider({ demoMode: false, integrations: {} }) instanceof DemoAppointmentProvider);
});

test('an unrecognized calendarProvider value falls back to the mock provider rather than throwing or pretending', () => {
  const practice = { demoMode: false, integrations: { calendarProvider: 'some_future_pms' } };
  assert.ok(getAppointmentProvider(practice) instanceof DemoAppointmentProvider);
});

test('the SmileVerse demo practice config itself resolves to the mock provider today (nothing switched it to production)', () => {
  const smileverse = require('../config/practices/smileverse-dental');
  assert.ok(getAppointmentProvider(smileverse) instanceof DemoAppointmentProvider);
});

// --- Phase 6: a PMS-enabled practice routes through PMSAppointmentProvider
// instead of the calendar path entirely, checked BEFORE demoMode/calendarProvider
// (spec §26: a clinic uses either a calendar or a PMS, never both at once).
const PMSAppointmentProvider = require('../services/pms/pmsAppointmentProvider');

test('PMS ROUTING: integrations.pmsProvider set to anything but "none" routes through PMSAppointmentProvider, regardless of calendarProvider', () => {
  const practice = { demoMode: true, integrations: { calendarProvider: 'google', pmsProvider: 'mock' } };
  assert.ok(getAppointmentProvider(practice) instanceof PMSAppointmentProvider);
});

test('PMS ROUTING: pmsProvider "none" (or unset) never touches the PMS path — zero behavior change from Phase 5', () => {
  assert.ok(getAppointmentProvider({ demoMode: true, integrations: { calendarProvider: 'demo', pmsProvider: 'none' } }) instanceof DemoAppointmentProvider);
  assert.ok(getAppointmentProvider({ demoMode: true, integrations: { calendarProvider: 'demo' } }) instanceof DemoAppointmentProvider);
});

test('PMS ROUTING: demoMode safety is enforced one layer down (services/pms/index.js), not bypassed by routing to the PMS path', () => {
  // Even though this practice routes to PMSAppointmentProvider, that
  // adapter's own internal getPMSProvider() call will still return the
  // mock PMS because demoMode is true — see pmsProviderSelection.test.js
  // and pmsAppointmentProvider.test.js for the full proof of that.
  const practice = { demoMode: true, integrations: { pmsProvider: 'openDental' } };
  assert.ok(getAppointmentProvider(practice) instanceof PMSAppointmentProvider);
});
