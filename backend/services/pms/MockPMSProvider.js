/**
 * Mock PMS provider — Phase 6 MVP. Simulates Open Dental's shape (patient
 * identity, PMS-native appointments, provider/operatory/appointment-type
 * directories) entirely in memory, so the whole PMS-aware booking flow —
 * patient search, multi-match disambiguation, new-patient creation,
 * mapping, availability, booking/reschedule/cancel — can be exercised
 * end-to-end with zero real credentials and zero risk of ever touching a
 * real clinic's data (spec §3/§28).
 *
 * This is intentionally a SEPARATE in-memory store from this app's own
 * MongoDB `Appointment` collection — exactly the way a real Open Dental
 * office has its own separate database. `services/pms/pmsAppointmentProvider.js`
 * is the layer that keeps this app's own `Appointment` documents and
 * `PMSSyncRecord`s in sync with whatever this (or the real Open Dental)
 * provider reports; this class never touches those collections itself
 * (spec §18: never build "a second competing appointment database" at
 * the app's OWN persistence layer — this is the vendor-side simulation,
 * not a second local database).
 *
 * State is isolated per practiceId and reset per process (acceptable for
 * a demo/dev mock — tests construct their own fresh instance so nothing
 * leaks between test files, matching this codebase's usual pattern of
 * never sharing mutable module state across `node --test` files, each of
 * which runs in its own process anyway).
 */

const PMSProvider = require('./PMSProvider');
const { AppointmentNotFoundError, SlotUnavailableError } = require('./PMSErrors');

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function matchesQuery(patient, { firstName, lastName, dateOfBirth, phone, email }) {
  if (lastName && patient.lastName.toLowerCase() !== lastName.toLowerCase()) return false;
  if (firstName && patient.firstName.toLowerCase() !== firstName.toLowerCase()) return false;
  if (dateOfBirth && patient.dateOfBirth !== dateOfBirth) return false;
  if (phone && normalizePhone(patient.phone) !== normalizePhone(phone)) return false;
  if (email && patient.email && patient.email.toLowerCase() !== email.toLowerCase()) return false;
  return true;
}

class MockPMSProvider extends PMSProvider {
  constructor() {
    super();
    this._byPractice = new Map();
  }

  get providerName() {
    return 'mock';
  }

  isConfigured() {
    return true; // the mock is always "configured" — it never needs real credentials
  }

  _store(practiceId) {
    if (!this._byPractice.has(practiceId)) {
      this._byPractice.set(practiceId, {
        patients: [
          // A couple of seeded, clearly-fake patients so multi-match /
          // existing-patient flows have something realistic to find —
          // never presented anywhere as real clinic data (spec §3).
          { externalPatientId: 'MOCK-PAT-1001', firstName: 'Sarah', lastName: 'Ahmed', dateOfBirth: '1990-04-12', phone: '+15551234567', email: 'sarah.ahmed@example.com' },
          { externalPatientId: 'MOCK-PAT-1002', firstName: 'John', lastName: 'Smith', dateOfBirth: '1985-11-02', phone: '+15559876543', email: null },
        ],
        appointments: [],
        nextPatientSeq: 1003,
        nextApptSeq: 5001,
      });
    }
    return this._byPractice.get(practiceId);
  }

  async testConnection(practice) {
    return {
      success: true,
      provider: this.providerName,
      latencyMs: 1,
      apiVersion: 'mock-1.0',
      error: null,
    };
  }

  async findPatients(practice, query = {}) {
    const store = this._store(practice.practiceId);
    return store.patients.filter((p) => matchesQuery(p, query)).map((p) => ({ ...p }));
  }

  async createPatient(practice, patientData) {
    const store = this._store(practice.practiceId);
    const externalPatientId = `MOCK-PAT-${store.nextPatientSeq++}`;
    const patient = {
      externalPatientId,
      firstName: patientData.firstName,
      lastName: patientData.lastName,
      dateOfBirth: patientData.dateOfBirth || null,
      phone: patientData.phone || null,
      email: patientData.email || null,
    };
    store.patients.push(patient);
    return { ...patient };
  }

  async getPatientAppointments(practice, externalPatientId) {
    const store = this._store(practice.practiceId);
    return store.appointments
      .filter((a) => a.externalPatientId === externalPatientId && a.status !== 'Cancelled')
      .map((a) => ({ ...a }));
  }

  async getProviders(practice) {
    return [
      { externalProviderId: 'MOCK-PROV-1', name: 'Dr. Default Provider' },
    ];
  }

  async getOperatories(practice) {
    return [
      { externalOperatoryId: 'MOCK-OP-1', name: 'Operatory 1' },
    ];
  }

  async getAppointmentTypes(practice) {
    // Mirrors this practice's own services list one-to-one, so a fresh
    // practice can configure mappings without having to guess IDs (spec
    // §11: "each practice must configure its own mappings" — this just
    // gives the mock a directory to map FROM).
    return (practice.services || []).map((s) => ({ externalAppointmentTypeId: `MOCK-APPTTYPE-${s.id}`, name: s.name }));
  }

  async getAvailability(practice, { date, providerId, operatoryId, lengthMinutes } = {}) {
    // Reuses the exact same mock scheduling logic every other demo
    // practice already runs on (services/availabilityService.js) so mock
    // PMS availability looks and behaves consistently with the rest of
    // the demo experience, then reshapes it into PMS-style slot objects.
    const availabilityService = require('../availabilityService');
    if (!availabilityService.isOpenDay(practice, date)) return [];
    const bookedTimes = this._store(practice.practiceId)
      .appointments.filter((a) => a.date === date && a.status !== 'Cancelled')
      .map((a) => a.time);
    const slots = availabilityService.getAvailableSlots(practice, date, { bookedTimes });
    // availabilityService returns { time, minutes } objects (the same
    // shape every other provider in this codebase uses) — reshape into
    // PMS-style slot objects carrying that same label under `startLabel`.
    return slots.map((slot) => ({
      startLabel: slot.time,
      providerId: providerId || 'MOCK-PROV-1',
      operatoryId: operatoryId || 'MOCK-OP-1',
    }));
  }

  async createAppointment(practice, appointmentData) {
    const store = this._store(practice.practiceId);
    // Re-check the slot is still actually free — protects against the
    // exact race the spec calls out (spec §17: "stale availability").
    const conflict = store.appointments.find(
      (a) => a.date === appointmentData.date && a.time === appointmentData.time && a.status !== 'Cancelled'
    );
    if (conflict) throw new SlotUnavailableError('busy');

    const externalAppointmentId = `MOCK-APT-${store.nextApptSeq++}`;
    const appointment = {
      externalAppointmentId,
      externalPatientId: appointmentData.externalPatientId,
      date: appointmentData.date,
      time: appointmentData.time,
      providerId: appointmentData.providerId || 'MOCK-PROV-1',
      operatoryId: appointmentData.operatoryId || 'MOCK-OP-1',
      appointmentTypeId: appointmentData.appointmentTypeId || null,
      status: 'Scheduled',
    };
    store.appointments.push(appointment);
    return { ...appointment };
  }

  async updateAppointment(practice, externalAppointmentId, patch) {
    const store = this._store(practice.practiceId);
    const appointment = store.appointments.find((a) => a.externalAppointmentId === externalAppointmentId);
    if (!appointment) throw new AppointmentNotFoundError();

    const newDate = patch.date || appointment.date;
    const newTime = patch.time || appointment.time;
    const conflict = store.appointments.find(
      (a) => a !== appointment && a.date === newDate && a.time === newTime && a.status !== 'Cancelled'
    );
    if (conflict) throw new SlotUnavailableError('busy');

    Object.assign(appointment, { date: newDate, time: newTime, status: 'Scheduled' });
    return { ...appointment };
  }

  async cancelAppointment(practice, externalAppointmentId) {
    const store = this._store(practice.practiceId);
    const appointment = store.appointments.find((a) => a.externalAppointmentId === externalAppointmentId);
    if (!appointment) throw new AppointmentNotFoundError();
    appointment.status = 'Cancelled';
    return { ...appointment };
  }
}

module.exports = MockPMSProvider;
