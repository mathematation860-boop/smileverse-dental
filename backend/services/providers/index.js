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
let pmsInstance = null;

/**
 * Phase 6: a practice with a PMS turned on (`integrations.pmsProvider`
 * set to anything other than 'none') routes booking through the PMS path
 * INSTEAD OF the calendar path, checked before the demoMode/calendar
 * switch below. This is a deliberate, practice-level choice — a clinic
 * uses either a calendar or a PMS as its source of truth, never both at
 * once (spec §26: "do not silently create duplicate appointments in both
 * systems"). demoMode safety still fully applies: it's enforced one
 * layer down, inside services/pms/index.js's own getPMSProvider() factory
 * (exactly like every other provider factory in this codebase), so a
 * demoMode:true practice with `pmsProvider: 'openDental'` configured
 * still always gets the mock PMS, never a real Open Dental call.
 *
 * Every existing practice (and any practice that never sets
 * `integrations.pmsProvider`, which stays 'none') keeps taking this
 * exact same demo/calendar path below — zero behavior change from
 * Phase 5.
 */
function getAppointmentProvider(practice) {
  const pmsProviderName = practice?.integrations?.pmsProvider;
  if (pmsProviderName && pmsProviderName !== 'none') {
    if (!pmsInstance) pmsInstance = new (require('../pms/pmsAppointmentProvider'))();
    return pmsInstance;
  }

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
