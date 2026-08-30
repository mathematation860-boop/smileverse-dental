/**
 * Appointment provider factory. Reads
 * `practice.integrations.calendarProvider` so different practices could
 * eventually run on different calendars/PMS systems — for now only
 * 'demo' is implemented, and everything else falls back to it with a
 * console warning rather than silently pretending to be a real
 * integration that doesn't exist.
 */

const DemoAppointmentProvider = require('./DemoAppointmentProvider');

const demoInstance = new DemoAppointmentProvider();

function getAppointmentProvider(practice) {
  const providerName = practice?.integrations?.calendarProvider || 'demo';

  switch (providerName) {
    case 'demo':
      return demoInstance;
    default:
      console.warn(`No real "${providerName}" calendar provider is implemented yet — falling back to the demo provider.`);
      return demoInstance;
  }
}

module.exports = { getAppointmentProvider };
