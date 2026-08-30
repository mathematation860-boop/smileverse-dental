/**
 * Structured PMS error categories (Phase 6 spec §22) — the same pattern
 * as services/providers/CalendarProviderErrors.js: one typed error class
 * per failure shape, each carrying a stable machine-readable `reason` and
 * an honest, non-technical patient-facing `message`, so a route/tool
 * layer never has to invent its own wording and the AI never has to
 * guess what went wrong (spec §23: "the AI must never invent PMS
 * information").
 *
 * Two existing calendar error classes are DELIBERATELY REUSED rather than
 * duplicated, because they mean exactly the same thing at the PMS layer:
 *  - SlotUnavailableError (services/providers/CalendarProviderErrors.js)
 *    for SLOT_UNAVAILABLE — "we asked, and the answer is no."
 *  - A PMS being unreachable/misconfigured maps onto the same
 *    "I can't currently check" shape as CalendarUnavailableError, so
 *    PMSUnavailableError below extends it directly — this lets
 *    utils/appointmentErrorResponse.js's existing `instanceof
 *    CalendarUnavailableError` branch keep handling it with zero changes,
 *    consistent with "do not duplicate error-handling logic."
 */

const { CalendarUnavailableError, SlotUnavailableError } = require('../providers/CalendarProviderErrors');

const PMS_UNAVAILABLE_MESSAGE_EN =
  "I'm having trouble accessing the clinic's appointment system right now. I can connect you with the front desk.";
const PMS_UNAVAILABLE_MESSAGE_UR =
  'معذرت، ابھی کلینک کے اپائنٹمنٹ سسٹم تک رسائی میں مشکل ہو رہی ہے۔ میں آپ کو فرنٹ ڈیسک سے ملوا سکتا ہوں۔';

const MULTIPLE_PATIENT_MATCH_MESSAGE_EN =
  "I found more than one patient matching that information. Could you provide your date of birth or full phone number so I can find the right record?";
const PATIENT_NOT_FOUND_MESSAGE_EN =
  "I couldn't find an existing patient record with that information. Are you a new patient, or could you double-check the details?";
const MAPPING_MISSING_MESSAGE_EN =
  "Our team needs to confirm the exact appointment type for that service before I can book it through our system. I can have the front desk follow up, or connect you now.";

/** PMS_NOT_CONFIGURED / PMS_AUTH_FAILED / PMS_TIMEOUT / generic PMS_UNAVAILABLE — extends CalendarUnavailableError so existing error-handling middleware (utils/appointmentErrorResponse.js) needs no changes to safely handle a PMS-backed practice. */
class PMSUnavailableError extends CalendarUnavailableError {
  constructor(reason, cause) {
    super(reason, cause);
    this.name = 'PMSUnavailableError';
    this.message = PMS_UNAVAILABLE_MESSAGE_EN;
  }
}

class PatientNotFoundError extends Error {
  constructor(reason = 'PATIENT_NOT_FOUND') {
    super(PATIENT_NOT_FOUND_MESSAGE_EN);
    this.name = 'PatientNotFoundError';
    this.reason = reason;
  }
}

class MultiplePatientMatchError extends Error {
  constructor(candidates = []) {
    super(MULTIPLE_PATIENT_MATCH_MESSAGE_EN);
    this.name = 'MultiplePatientMatchError';
    this.reason = 'MULTIPLE_PATIENT_MATCH';
    // Only non-sensitive disambiguation hints (e.g. count) should ever be
    // surfaced to a caller — never the other candidates' full records,
    // which would leak one patient's identity to another caller asking
    // about a shared phone number (spec §7: "never expose a list of
    // unrelated patients to the caller").
    this.matchCount = candidates.length;
  }
}

class PatientCreationFailedError extends Error {
  constructor(reason = 'PATIENT_CREATION_FAILED', cause) {
    super('I was not able to create a new patient record right now. I can connect you with the front desk to finish this.');
    this.name = 'PatientCreationFailedError';
    this.reason = reason;
    this.cause = cause;
  }
}

class AppointmentNotFoundError extends Error {
  constructor(reason = 'APPOINTMENT_NOT_FOUND') {
    super("I couldn't find that appointment in our system.");
    this.name = 'AppointmentNotFoundError';
    this.reason = reason;
  }
}

class BookingFailedError extends Error {
  constructor(reason = 'BOOKING_FAILED', cause) {
    super('I was not able to complete that booking through our system. I can connect you with the front desk.');
    this.name = 'BookingFailedError';
    this.reason = reason;
    this.cause = cause;
  }
}

class CancellationFailedError extends Error {
  constructor(reason = 'CANCELLATION_FAILED', cause) {
    super('I was not able to cancel that appointment through our system right now. I can connect you with the front desk.');
    this.name = 'CancellationFailedError';
    this.reason = reason;
    this.cause = cause;
  }
}

class RescheduleFailedError extends Error {
  constructor(reason = 'RESCHEDULE_FAILED', cause) {
    super('I was not able to reschedule that appointment through our system right now. I can connect you with the front desk.');
    this.name = 'RescheduleFailedError';
    this.reason = reason;
    this.cause = cause;
  }
}

/** Missing/ambiguous service->appointment-type (or provider/operatory) mapping (spec §11/§12/§13) — never guessed, always surfaced honestly. */
class InvalidConfigurationError extends Error {
  constructor(reason = 'INVALID_CONFIGURATION') {
    super(MAPPING_MISSING_MESSAGE_EN);
    this.name = 'InvalidConfigurationError';
    this.reason = reason;
  }
}

module.exports = {
  PMSUnavailableError,
  PatientNotFoundError,
  MultiplePatientMatchError,
  PatientCreationFailedError,
  AppointmentNotFoundError,
  BookingFailedError,
  CancellationFailedError,
  RescheduleFailedError,
  InvalidConfigurationError,
  SlotUnavailableError, // re-exported for convenience — same class as calendar's
  PMS_UNAVAILABLE_MESSAGE_EN,
  PMS_UNAVAILABLE_MESSAGE_UR,
  MULTIPLE_PATIENT_MATCH_MESSAGE_EN,
  PATIENT_NOT_FOUND_MESSAGE_EN,
  MAPPING_MISSING_MESSAGE_EN,
};
