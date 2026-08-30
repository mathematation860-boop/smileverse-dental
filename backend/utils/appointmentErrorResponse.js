/**
 * Shared translation from the typed calendar errors (Phase 2) into a
 * truthful HTTP response. Extracted out of routes/appointments.js in
 * Phase 3 so the new admin appointment routes (routes/adminAppointments.js)
 * can reuse the EXACT same mapping instead of a second copy — "do not
 * duplicate appointment logic" applies to error handling too, not just
 * the booking/cancel/reschedule calls themselves.
 */

const { CalendarUnavailableError, SlotUnavailableError } = require('../services/providers/CalendarProviderErrors');
// Phase 6: PMSUnavailableError extends CalendarUnavailableError directly
// (see services/pms/PMSErrors.js's header comment) specifically so the
// `instanceof CalendarUnavailableError` branch below already handles it
// correctly with no changes — the remaining PMS-specific error types are
// handled explicitly.
const {
  PatientNotFoundError,
  MultiplePatientMatchError,
  PatientCreationFailedError,
  AppointmentNotFoundError,
  BookingFailedError,
  CancellationFailedError,
  RescheduleFailedError,
  InvalidConfigurationError,
} = require('../services/pms/PMSErrors');

function handleAppointmentError(error, res, genericMessage) {
  if (error instanceof CalendarUnavailableError) {
    console.error('Calendar/PMS unavailable:', error.reason, error.cause?.message || '');
    return res.status(503).json({ error: error.message, reason: error.reason });
  }
  if (error instanceof SlotUnavailableError) {
    return res.status(409).json({ error: error.message, reason: error.reason });
  }
  if (error instanceof MultiplePatientMatchError) {
    return res.status(409).json({ error: error.message, reason: error.reason, matchCount: error.matchCount });
  }
  if (error instanceof PatientNotFoundError || error instanceof AppointmentNotFoundError) {
    return res.status(404).json({ error: error.message, reason: error.reason });
  }
  if (error instanceof InvalidConfigurationError) {
    return res.status(503).json({ error: error.message, reason: error.reason });
  }
  if (
    error instanceof PatientCreationFailedError ||
    error instanceof BookingFailedError ||
    error instanceof CancellationFailedError ||
    error instanceof RescheduleFailedError
  ) {
    console.error('PMS operation failed:', error.name, error.reason, error.cause?.message || '');
    return res.status(502).json({ error: error.message, reason: error.reason });
  }
  console.error(genericMessage, error);
  return res.status(500).json({ error: genericMessage });
}

module.exports = { handleAppointmentError };
