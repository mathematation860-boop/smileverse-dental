/**
 * Appointment provider factory.
 *
 * `practice.demoMode` is the master safety switch (Phase 2): as long as
 * it's true — which is the default for every practice, including the
 * SmileVerse demo practice — this ALWAYS returns the mock provider,
 * regardless of what `integrations.calendarProvider` says. Real Google
 * Calendar events are only ever created when a practice has BOTH
 * `demoMode: false` AND `integrations.calendarProvider: 'google'` set in
 * its config file, which is a deliberate, reviewed code change — never
 * something a runtime request can flip.
 *
 * Once out of demo mode, `integrations.calendarProvider` picks which real
 * provider serves that practice, so more calendars/PMS systems can be
 * added later without touching this switch's shape — for now only
 * 'google' is implemented, and anything else falls back to demo with a
 * console warning rather than silently pretending to be a real
 * integration that doesn't exist.
 */

const DemoAppointmentProvider = require('./DemoAppointmentProvider');
const GoogleCalendarAppointmentProvider = require('./GoogleCalendarAppointmentProvider');

const demoInstance = new DemoAppointmentProvider();
const googleInstance = new GoogleCalendarAppointmentProvider();

function getAppointmentProvider(practice) {
  if (practice?.demoMode !== false) return demoInstance;

  const providerName = practice?.integrations?.calendarProvider || 'demo';

  switch (providerName) {
    case 'google':
      return googleInstance;
    case 'demo':
      return demoInstance;
    default:
      console.warn(`No real "${providerName}" calendar provider is implemented yet — falling back to the demo provider.`);
      return demoInstance;
  }
}

module.exports = { getAppointmentProvider };
