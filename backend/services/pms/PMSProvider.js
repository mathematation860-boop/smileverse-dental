/**
 * Dental Practice Management System (PMS) provider interface (Phase 6
 * MVP — Open Dental). This is the LOW-LEVEL, PMS-shaped contract: it
 * speaks in terms of PMS concepts (a patient identity, a PMS-native
 * appointment, provider/operatory/appointment-type IDs) rather than this
 * app's own Appointment shape.
 *
 * `services/pms/pmsAppointmentProvider.js` is the adapter layer that
 * implements THIS app's existing `AppointmentProvider` interface (see
 * services/providers/AppointmentProvider.js) by orchestrating calls
 * against whichever PMSProvider a practice is configured for — the
 * receptionist/tools layer never talks to a PMSProvider directly, and
 * never knows whether Open Dental or the mock is underneath (spec §2:
 * "The receptionist should NOT know whether the underlying PMS is Open
 * Dental or mock").
 *
 * Every method that changes something in the PMS should genuinely
 * confirm the change happened before returning — a provider
 * implementation must never fabricate a success. Read the class-level
 * comments on MockPMSProvider.js and OpenDentalPMSProvider.js for how
 * each concrete implementation satisfies that.
 */
class PMSProvider {
  get providerName() {
    throw new Error('PMSProvider.providerName not implemented');
  }

  isConfigured() {
    throw new Error('PMSProvider.isConfigured() not implemented');
  }

  /** A safe, read-only request proving credentials are valid and the endpoint is reachable. Must NEVER create/modify any patient or appointment (spec §6). Returns { success, provider, latencyMs, apiVersion, error } — never throws for an ordinary connectivity/auth failure (that's exactly what this method reports on), only for genuine programmer error. */
  // eslint-disable-next-line no-unused-vars
  async testConnection(practice) {
    throw new Error('PMSProvider.testConnection() not implemented');
  }

  /** Searches for existing patients by one or more identifiers (name, dateOfBirth, phone, email — spec §7). Must NEVER rely on name alone: implementations should treat a name-only query as inherently ambiguous. Returns an array (possibly empty, possibly more than one). */
  // eslint-disable-next-line no-unused-vars
  async findPatients(practice, { firstName, lastName, dateOfBirth, phone, email } = {}) {
    throw new Error('PMSProvider.findPatients() not implemented');
  }

  /** Creates a new patient record. Must only be called after the minimum information the PMS requires has actually been collected and confirmed (spec §8) — never called speculatively/incompletely. */
  // eslint-disable-next-line no-unused-vars
  async createPatient(practice, patientData) {
    throw new Error('PMSProvider.createPatient() not implemented');
  }

  /** Every upcoming (and, where the PMS returns it, recent) appointment for one already-identified patient (spec §9). */
  // eslint-disable-next-line no-unused-vars
  async getPatientAppointments(practice, externalPatientId) {
    throw new Error('PMSProvider.getPatientAppointments() not implemented');
  }

  /** The PMS's own provider (dentist/hygienist) directory — used for provider mapping (spec §12), never invented locally. */
  // eslint-disable-next-line no-unused-vars
  async getProviders(practice) {
    throw new Error('PMSProvider.getProviders() not implemented');
  }

  /** The PMS's own operatory (chair/room) directory — used for operatory mapping (spec §13), never invented locally. */
  // eslint-disable-next-line no-unused-vars
  async getOperatories(practice) {
    throw new Error('PMSProvider.getOperatories() not implemented');
  }

  /** The PMS's own appointment-type/procedure directory — used for service mapping (spec §11), never invented locally. */
  // eslint-disable-next-line no-unused-vars
  async getAppointmentTypes(practice) {
    throw new Error('PMSProvider.getAppointmentTypes() not implemented');
  }

  /** Real, PMS-sourced open slots for a given day (spec §10) — never derived solely from this app's own local mock database once a practice is on a real PMS. Returns an array of { startIso, endIso, providerId, operatoryId }. */
  // eslint-disable-next-line no-unused-vars
  async getAvailability(practice, { date, providerId, operatoryId, lengthMinutes } = {}) {
    throw new Error('PMSProvider.getAvailability() not implemented');
  }

  /** Creates a real appointment in the PMS. Must return a value with a genuine external appointment id — never persisted or reported as success without one (spec §14). */
  // eslint-disable-next-line no-unused-vars
  async createAppointment(practice, appointmentData) {
    throw new Error('PMSProvider.createAppointment() not implemented');
  }

  /** Updates (reschedules) an existing PMS appointment (spec §16) — never assumes the appointment can simply be re-created. */
  // eslint-disable-next-line no-unused-vars
  async updateAppointment(practice, externalAppointmentId, patch) {
    throw new Error('PMSProvider.updateAppointment() not implemented');
  }

  /** Cancels/breaks an existing PMS appointment (spec §15) — implementations must use whatever the PMS's OWN documented semantics are for "cancelled" (e.g. a status change), never assume a DELETE verb is correct. */
  // eslint-disable-next-line no-unused-vars
  async cancelAppointment(practice, externalAppointmentId) {
    throw new Error('PMSProvider.cancelAppointment() not implemented');
  }
}

module.exports = PMSProvider;
