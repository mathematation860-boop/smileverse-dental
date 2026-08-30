/**
 * Dental Practice Management System (PMS) provider interface — NOT
 * implemented or wired into any route yet. This exists purely as the
 * documented integration point for later, per the "don't invent
 * unsupported APIs" instruction.
 *
 * A real PMS (Dentrix, OpenDental, Curve, Eaglesoft, etc.) would have
 * its own auth, patient-matching, and scheduling semantics — those
 * details are unknown until a specific PMS and its API docs are in
 * hand, so this interface only sketches the operations the rest of the
 * app would need from it. When a real PMS is integrated:
 *   1. Add a class here (or in its own file) extending PMSProvider.
 *   2. Set practice.integrations.pmsProvider to that provider's name.
 *   3. Have AppointmentProvider's factory (./index.js) delegate to it
 *      for that practice instead of DemoAppointmentProvider.
 * Until then, `practice.integrations.pmsProvider` stays 'none' for every
 * practice and nothing in the app calls this file.
 */
class PMSProvider {
  // eslint-disable-next-line no-unused-vars
  async findPatient(practice, { name, phone, dateOfBirth }) {
    throw new Error('PMSProvider.findPatient() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async createPatient(practice, patientData) {
    throw new Error('PMSProvider.createPatient() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async getAppointments(practice, patientId) {
    throw new Error('PMSProvider.getAppointments() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async getAvailability(practice, date) {
    throw new Error('PMSProvider.getAvailability() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async createAppointment(practice, appointmentData) {
    throw new Error('PMSProvider.createAppointment() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async updateAppointment(practice, appointmentId, patch) {
    throw new Error('PMSProvider.updateAppointment() not implemented — no real PMS is connected yet');
  }

  // eslint-disable-next-line no-unused-vars
  async cancelAppointment(practice, appointmentId) {
    throw new Error('PMSProvider.cancelAppointment() not implemented — no real PMS is connected yet');
  }
}

module.exports = PMSProvider;
