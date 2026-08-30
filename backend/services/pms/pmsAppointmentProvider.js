/**
 * PMS-backed AppointmentProvider adapter (Phase 6 spec §2's diagram:
 * Receptionist -> tools -> Appointment/PMS service -> PMSProvider ->
 * OpenDentalPMSProvider OR MockPMSProvider).
 *
 * This class implements the SAME `AppointmentProvider` interface every
 * other calendar provider implements (services/providers/AppointmentProvider.js),
 * so `tools/receptionistTools.js` — and therefore the web widget, the
 * voice receptionist, and inbound SMS, which all call the exact same
 * tools functions — need ZERO changes to book/reschedule/cancel through
 * a PMS instead of the demo/Google calendar path (spec §24/§25: "the
 * receptionist should NOT know whether the underlying PMS is Open Dental
 * or mock," and voice/SMS must reuse the same tools, never a second
 * implementation).
 *
 * What's genuinely new here, beyond what the calendar providers do:
 *  - Patient identity: every booking/lookup first resolves (or creates)
 *    a PMS patient record (spec §7/§8) — a calendar has no such concept.
 *  - Service/provider/operatory mapping (spec §11/§12/§13) — a PMS
 *    appointment needs a PMS-native AppointmentTypeNum/ProvNum/OpNum,
 *    never guessed.
 *  - A local sync record links this app's own Appointment document to
 *    the PMS's external appointment id (spec §19) — the PMS becomes the
 *    source of truth for PMS-side state once live; this app's own
 *    Appointment collection remains the ONE local representation the
 *    rest of the app (notifications, admin dashboard, this app's own
 *    reschedule/cancel calls) already knows how to work with, so nothing
 *    downstream needs to change either.
 *
 * Every method here follows the same "never persist/claim success
 * without genuine PMS confirmation first" rule Phase 2's
 * GoogleCalendarAppointmentProvider.js established (spec §14/§15/§16):
 * the PMS call happens FIRST; the local Appointment record and sync
 * record are only written/updated AFTER a real success.
 */

const AppointmentProvider = require('../providers/AppointmentProvider');
const availabilityService = require('../availabilityService');
const { getServiceDuration } = require('../providers/googleCalendarLogic');
const { getMinutesSinceMidnightInTimezone } = require('../../utils/timezone');
const { getPMSProvider } = require('./index');
const defaultAppointmentRepo = require('../../repositories/AppointmentRepository');
const defaultSyncRepo = require('../../repositories/PMSSyncRecordRepository');
const defaultAuditRepo = require('../../repositories/PMSAuditLogRepository');
const {
  PatientNotFoundError,
  MultiplePatientMatchError,
  PatientCreationFailedError,
  InvalidConfigurationError,
  SlotUnavailableError,
  BookingFailedError,
} = require('./PMSErrors');

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: undefined, lastName: undefined };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function slotToLabel(slot, practice) {
  if (!slot) return null;
  if (slot.startLabel) return slot.startLabel;
  if (slot.startIso) {
    const d = new Date(slot.startIso);
    if (Number.isNaN(d.getTime())) return null;
    return availabilityService.minutesToLabel(getMinutesSinceMidnightInTimezone(d, practice.timezone));
  }
  return null;
}

class PMSAppointmentProvider extends AppointmentProvider {
  constructor(deps = {}) {
    super();
    this.getPmsProvider = deps.getPMSProvider || getPMSProvider;
    this.appointmentRepo = deps.appointmentRepo || defaultAppointmentRepo;
    this.syncRepo = deps.syncRepo || defaultSyncRepo;
    this.auditRepo = deps.auditRepo || defaultAuditRepo;
  }

  _audit(practice, event, patch = {}) {
    // Fire-and-forget, non-blocking — an audit-log write must never slow
    // down or fail a real booking/lookup (mirrors notificationService.js's
    // own "never let logging break the real operation" rule).
    this.auditRepo.record(practice.practiceId, { event, provider: this._pms(practice)?.providerName || null, ...patch }).catch(() => {});
  }

  _pms(practice) {
    return this.getPmsProvider(practice);
  }

  /** Resolves (or creates) the PMS patient for a booking request. Never relies on name alone (spec §7): phone is the primary identifier, name only narrows a household sharing one phone number. */
  async _resolvePatient(practice, pms, { name, phone, email, dateOfBirth, patientType }) {
    const { firstName, lastName } = splitName(name);
    let matches = await pms.findPatients(practice, { phone, dateOfBirth, email });
    this._audit(practice, 'patient_lookup', { outcome: 'success' });

    if (matches.length > 1 && lastName) {
      const narrowed = matches.filter((m) => m.lastName && m.lastName.toLowerCase() === lastName.toLowerCase());
      if (narrowed.length > 0) matches = narrowed;
    }

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new MultiplePatientMatchError(matches);

    if (patientType === 'existing') {
      throw new PatientNotFoundError();
    }

    if (!firstName || !lastName || !phone) {
      throw new PatientCreationFailedError('PATIENT_INFO_INCOMPLETE');
    }

    try {
      const created = await pms.createPatient(practice, { firstName, lastName, phone, email, dateOfBirth });
      this._audit(practice, 'patient_created', { outcome: 'success' });
      return created;
    } catch (err) {
      this._audit(practice, 'patient_created', { outcome: 'failure', failureReason: err.reason || err.message });
      throw err;
    }
  }

  /** Resolves this service's PMS appointment-type id (spec §11) — never guessed. The mock provider gets a working default out of the box (its own appointment types are generated 1:1 from this practice's services); a real PMS requires an explicit admin-configured mapping. */
  _resolveAppointmentTypeId(practice, pms, serviceId) {
    const configured = practice.pms?.serviceMappings?.[serviceId]?.openDentalAppointmentTypeNum;
    if (configured != null && configured !== '') return String(configured);
    if (pms.providerName === 'mock') return `MOCK-APPTTYPE-${serviceId}`;
    throw new InvalidConfigurationError('SERVICE_MAPPING_MISSING');
  }

  /** Resolves a default provider/operatory (spec §12/§13) — an explicit admin mapping wins; otherwise falls back to the FIRST entry the PMS's own directory reports (never an invented/hard-coded id). */
  async _resolveProviderOperatory(practice, pms) {
    const configuredProv = practice.pms?.providerMappings?.default?.openDentalProvNum;
    const configuredOp = practice.pms?.operatoryMappings?.default?.openDentalOpNum;

    let providerId = configuredProv != null && configuredProv !== '' ? String(configuredProv) : null;
    let operatoryId = configuredOp != null && configuredOp !== '' ? String(configuredOp) : null;

    if (!providerId) {
      const providers = await pms.getProviders(practice);
      providerId = providers[0]?.externalProviderId || null;
    }
    if (!operatoryId) {
      const operatories = await pms.getOperatories(practice);
      operatoryId = operatories[0]?.externalOperatoryId || null;
    }
    return { providerId, operatoryId };
  }

  async getAvailability(practice, dateStr, { durationMinutes } = {}) {
    if (!availabilityService.isOpenDay(practice, dateStr)) {
      return { date: dateStr, isOpen: false, slots: [] };
    }
    const pms = this._pms(practice);
    const { providerId, operatoryId } = await this._resolveProviderOperatory(practice, pms);
    const lengthMinutes = durationMinutes || practice.hours?.slotMinutes || 30;

    this._audit(practice, 'availability_lookup', { outcome: 'success' });
    const slots = await pms.getAvailability(practice, { date: dateStr, providerId, operatoryId, lengthMinutes });
    // Reshape into the SAME { time, minutes } slot shape every other
    // AppointmentProvider in this codebase returns (see
    // services/availabilityService.js#getAvailableSlots and
    // services/providers/googleCalendarLogic.js#computeAvailableSlots) —
    // this is what the booking UI/tools layer already expects, regardless
    // of which provider is actually backing a practice.
    const labels = slots.map((s) => slotToLabel(s, practice)).filter(Boolean);
    const uniqueLabels = [...new Set(labels)];
    const shaped = uniqueLabels
      .map((time) => ({ time, minutes: availabilityService.labelToMinutes(time) }))
      .filter((s) => s.minutes !== null)
      .sort((a, b) => a.minutes - b.minutes);

    return { date: dateStr, isOpen: true, slots: shaped };
  }

  getAvailableDates(practice, count) {
    // Which days the practice is open is a business-hours fact, not a PMS
    // fact — mirrors Demo/Google's identical reasoning.
    return availabilityService.nextOpenDates(practice, count);
  }

  async createAppointment(practice, data) {
    const pms = this._pms(practice);
    const patient = await this._resolvePatient(practice, pms, data);
    const appointmentTypeId = this._resolveAppointmentTypeId(practice, pms, data.serviceId);
    const { providerId, operatoryId } = await this._resolveProviderOperatory(practice, pms);

    const minutes = availabilityService.labelToMinutes(data.time);
    if (minutes === null) throw new BookingFailedError('INVALID_TIME');
    const time24 = availabilityService.minutesToHHMM(minutes);

    const duration = getServiceDuration(practice, data.serviceId, practice.hours?.slotMinutes || 30);
    // Re-check the slot immediately before booking (spec §14 step 7 /
    // §17 double-booking protection) — never trust availability the
    // patient saw a few messages ago.
    const freshSlots = await pms.getAvailability(practice, { date: data.date, providerId, operatoryId, lengthMinutes: duration });
    const stillFree = freshSlots.some((s) => slotToLabel(s, practice) === data.time);
    if (!stillFree) {
      this._audit(practice, 'booking_failed', { outcome: 'failure', failureReason: 'SLOT_UNAVAILABLE' });
      throw new SlotUnavailableError('busy');
    }

    let externalAppt;
    try {
      externalAppt = await pms.createAppointment(practice, {
        externalPatientId: patient.externalPatientId,
        date: data.date,
        time: data.time,
        time24,
        providerId,
        operatoryId,
        appointmentTypeId,
      });
      this._audit(practice, 'booking_succeeded', { externalAppointmentId: externalAppt.externalAppointmentId, outcome: 'success' });
    } catch (err) {
      this._audit(practice, 'booking_failed', { outcome: 'failure', failureReason: err.reason || err.message });
      throw err;
    }

    // Only NOW — after the PMS genuinely confirmed the booking — does a
    // local Appointment record get created (spec §14 step 10/§25).
    const localAppointment = await this.appointmentRepo.create(practice.practiceId, {
      ...data,
      status: 'Confirmed',
      pmsProvider: pms.providerName,
      pmsAppointmentId: externalAppt.externalAppointmentId,
      pmsPatientId: patient.externalPatientId,
    });

    await this.syncRepo.linkAppointment(practice.practiceId, {
      localAppointmentId: localAppointment._id,
      externalAppointmentId: externalAppt.externalAppointmentId,
      externalPatientId: patient.externalPatientId,
      provider: pms.providerName,
    });

    return localAppointment;
  }

  async rescheduleAppointment(practice, id, { date, time }) {
    const pms = this._pms(practice);
    const appointment = await this.appointmentRepo.findById(practice.practiceId, id);
    if (!appointment) return null;
    if (!appointment.pmsAppointmentId) {
      // Never booked through the PMS in the first place (e.g. created
      // while this practice ran on the demo/calendar path) — nothing
      // real to reschedule on the PMS side.
      throw new BookingFailedError('NOT_PMS_BACKED');
    }

    const newDate = date || appointment.date;
    const newTime = time || appointment.time;
    const { providerId, operatoryId } = await this._resolveProviderOperatory(practice, pms);
    const duration = getServiceDuration(practice, appointment.serviceId, practice.hours?.slotMinutes || 30);

    const freshSlots = await pms.getAvailability(practice, { date: newDate, providerId, operatoryId, lengthMinutes: duration });
    const stillFree = freshSlots.some((s) => slotToLabel(s, practice) === newTime);
    if (!stillFree) {
      this._audit(practice, 'reschedule_failed', { externalAppointmentId: appointment.pmsAppointmentId, localAppointmentId: String(id), outcome: 'failure', failureReason: 'SLOT_UNAVAILABLE' });
      throw new SlotUnavailableError('busy');
    }

    const minutes = availabilityService.labelToMinutes(newTime);
    if (minutes === null) throw new SlotUnavailableError('invalid_time');
    const time24 = availabilityService.minutesToHHMM(minutes);

    try {
      await pms.updateAppointment(practice, appointment.pmsAppointmentId, { date: newDate, time24, providerId, operatoryId });
      this._audit(practice, 'reschedule_succeeded', { externalAppointmentId: appointment.pmsAppointmentId, localAppointmentId: String(id), outcome: 'success' });
    } catch (err) {
      this._audit(practice, 'reschedule_failed', { externalAppointmentId: appointment.pmsAppointmentId, localAppointmentId: String(id), outcome: 'failure', failureReason: err.reason || err.message });
      throw err;
    }

    const updated = await this.appointmentRepo.update(practice.practiceId, id, { date: newDate, time: newTime, status: 'Rescheduled' });
    await this.syncRepo.updateStatus(practice.practiceId, id, 'rescheduled');
    return updated;
  }

  async cancelAppointment(practice, id) {
    const pms = this._pms(practice);
    const appointment = await this.appointmentRepo.findById(practice.practiceId, id);
    if (!appointment) return null;

    if (appointment.pmsAppointmentId) {
      try {
        await pms.cancelAppointment(practice, appointment.pmsAppointmentId);
        this._audit(practice, 'cancellation_succeeded', { externalAppointmentId: appointment.pmsAppointmentId, localAppointmentId: String(id), outcome: 'success' });
      } catch (err) {
        this._audit(practice, 'cancellation_failed', { externalAppointmentId: appointment.pmsAppointmentId, localAppointmentId: String(id), outcome: 'failure', failureReason: err.reason || err.message });
        throw err;
      }
    }

    const updated = await this.appointmentRepo.update(practice.practiceId, id, { status: 'Cancelled' });
    if (appointment.pmsAppointmentId) await this.syncRepo.updateStatus(practice.practiceId, id, 'cancelled');
    return updated;
  }

  async getAppointment(practice, id) {
    // This app's own local Appointment record remains the single shape
    // every other layer (notifications, admin dashboard) already knows
    // how to read — identical reasoning to Demo/Google's getAppointment.
    return this.appointmentRepo.findById(practice.practiceId, id);
  }

  /** "What appointments do I have?" (spec §9) — resolves the patient from the PMS live (never stale local guesswork), then reads that patient's real PMS appointments, matched back to this app's own local records via the sync map so the rest of the app gets its usual, richer Appointment shape (name/service/etc., which the PMS's own record for THIS app's purposes doesn't need to duplicate). A PMS-side appointment with no local counterpart (e.g. booked directly in the PMS, outside this receptionist) is out of scope for this MVP — see the Phase 6 report's stated limitations. */
  async searchAppointments(practice, phone) {
    const pms = this._pms(practice);
    const matches = await pms.findPatients(practice, { phone });
    this._audit(practice, 'appointment_lookup', { outcome: 'success' });
    if (matches.length !== 1) {
      // Zero or ambiguous matches — never guess which patient's
      // appointments to reveal (spec §7).
      return [];
    }
    const externalAppointments = await pms.getPatientAppointments(practice, matches[0].externalPatientId);
    const local = await Promise.all(
      externalAppointments.map(async (ext) => {
        const sync = await this.syncRepo.findByExternalAppointmentId(practice.practiceId, ext.externalAppointmentId);
        if (!sync) return null;
        return this.appointmentRepo.findById(practice.practiceId, sync.localAppointmentId);
      })
    );
    return local.filter(Boolean);
  }

  async getAllAppointments(practice) {
    return this.appointmentRepo.findAll(practice.practiceId);
  }
}

module.exports = PMSAppointmentProvider;
