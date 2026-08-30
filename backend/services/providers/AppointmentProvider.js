/**
 * Appointment/calendar provider interface.
 *
 * Routes and the tools layer talk to "an appointment provider" for a
 * given practice — never to Mongoose or a specific vendor SDK directly.
 * Today every practice uses DemoAppointmentProvider (mock availability +
 * MongoDB-backed bookings). A real integration (Google Calendar,
 * Microsoft Calendar, a dental PMS, a custom scheduling API) is added by
 * writing a new class that implements this same interface and wiring it
 * up in ./index.js based on `practice.integrations.calendarProvider` —
 * no route, no frontend component, and no AI prompt needs to change.
 */
class AppointmentProvider {
  // eslint-disable-next-line no-unused-vars
  async getAvailability(practice, date) {
    throw new Error('AppointmentProvider.getAvailability() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async createAppointment(practice, data) {
    throw new Error('AppointmentProvider.createAppointment() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async rescheduleAppointment(practice, id, data) {
    throw new Error('AppointmentProvider.rescheduleAppointment() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async cancelAppointment(practice, id) {
    throw new Error('AppointmentProvider.cancelAppointment() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async getAppointment(practice, id) {
    throw new Error('AppointmentProvider.getAppointment() not implemented');
  }

  // eslint-disable-next-line no-unused-vars
  async searchAppointments(practice, phone) {
    throw new Error('AppointmentProvider.searchAppointments() not implemented');
  }
}

module.exports = AppointmentProvider;
