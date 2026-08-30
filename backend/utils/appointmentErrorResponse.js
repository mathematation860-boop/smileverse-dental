/**
 * Shared translation from the typed calendar errors (Phase 2) into a
 * truthful HTTP response. Extracted out of routes/appointments.js in
 * Phase 3 so the new admin appointment routes (routes/adminAppointments.js)
 * can reuse the EXACT same mapping instead of a second copy — "do not
 * duplicate appointment logic" applies to error handling too, not just
 * the booking/cancel/reschedule calls themselves.
 */

const { CalendarUnavailableError, SlotUnavailableError } = require('../services/providers/CalendarProviderErrors');

function handleAppointmentError(error, res, genericMessage) {
  if (error instanceof CalendarUnavailableError) {
    console.error('Calendar unavailable:', error.reason, error.cause?.message || '');
    return res.status(503).json({ error: error.message, reason: error.reason });
  }
  if (error instanceof SlotUnavailableError) {
    return res.status(409).json({ error: error.message, reason: error.reason });
  }
  console.error(genericMessage, error);
  return res.status(500).json({ error: genericMessage });
}

module.exports = { handleAppointmentError };
