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
