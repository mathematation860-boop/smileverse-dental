/**
 * Patient-facing appointment API.
 *
 * SECURITY NOTE (audit, Sept 2026). Every route in this file is
 * UNAUTHENTICATED — it serves the anonymous receptionist widget, where the
 * only thing the client sends about identity is an X-Practice-Id header,
 * which is not a trust boundary. Three routes treated it as one:
 *
 *   - GET /appointments returned every appointment in the practice
 *     (name, phone, email, service, date) to any caller. Removed; the
 *     authenticated equivalent is GET /admin/appointments.
 *   - GET /appointments/search?phone= returned a patient's appointments to
 *     anyone who knew or guessed their phone number. Replaced by
 *     POST /appointments/lookup, which additionally requires the booking
 *     reference and is rate limited.
 *   - PATCH and DELETE /appointments/:id changed or cancelled any
 *     appointment whose id the caller had, with no proof of ownership.
 *     Both now require the booking reference.
 *
 * The pattern throughout: the phone number says WHICH record, the booking
 * reference proves it is the caller's. See
 * services/appointments/bookingReference.js.
 */

const express = require('express');
const tools = require('../tools/receptionistTools');
const { requireFields, enforceMaxLengths } = require('../middleware/validate');
const { handleAppointmentError } = require('../utils/appointmentErrorResponse');
const patientAccessLimiter = require('../services/appointments/patientAccessLimiter');
const { normalizeBookingReference } = require('../services/appointments/bookingReference');

// Deliberately identical for "no such appointment", "wrong reference" and
// "wrong phone". A response that distinguished them would let an attacker
// confirm that a given phone number belongs to a patient here, which is
// itself information this clinic should not hand out.
const ACCESS_DENIED = 'We could not find an appointment matching that phone number and booking reference.';

/**
 * Reads a request header whether or not Express's `req.get` is present.
 * The route tests dispatch plain req objects through the router stack (see
 * tests/helpers/invokeRoute.js) rather than starting an HTTP server, so
 * the routes must not assume Express has decorated the request.
 */
function header(req, name) {
  if (typeof req.get === 'function') return req.get(name);
  const headers = req.headers || {};
  return headers[name.toLowerCase()] || null;
}

/**
 * The subset of an appointment a patient may see about their own booking.
 * Whitelisted rather than filtered, so a field added to the schema later
 * is not published by accident.
 */
function patientView(appointment) {
  if (!appointment) return null;
  return {
    _id: appointment._id,
    name: appointment.name,
    phone: appointment.phone,
    email: appointment.email,
    service: appointment.service,
    serviceId: appointment.serviceId,
    reason: appointment.reason,
    date: appointment.date,
    time: appointment.time,
    status: appointment.status,
    isEmergency: appointment.isEmergency,
    bookingReference: appointment.bookingReference,
    confirmedAt: appointment.confirmedAt,
    updatedAt: appointment.updatedAt,
  };
}

/**
 * Built as a factory — the same pattern routes/admin*.js already use — so
 * the access rules above can be exercised against injected fakes. Without
 * it these routes could only be checked by reading them, and every hole
 * this file was written to close was invisible to a code read for six
 * phases.
 */
function buildAppointmentsRouter(deps = {}) {
  const t = deps.tools || tools;
  const limiter = deps.patientAccessLimiter || patientAccessLimiter;
  const router = express.Router();

  // Book a new appointment.
  router.post('/appointments', enforceMaxLengths(['name', 'phone', 'email']), async (req, res) => {
    try {
      const missing = requireFields(req.body, ['name', 'phone', 'service', 'date']);
      if (missing) return res.status(400).json({ error: missing });

      const {
        name, phone, email, service, serviceId, patientType, reason, date, time,
        isEmergency, conversationId, smsOptIn, emailOptIn, language,
      } = req.body;

      const appointment = await t.create_appointment(req.practice, {
        name,
        phone,
        email,
        service,
        serviceId,
        patientType: patientType === 'existing' ? 'existing' : 'new',
        reason,
        date,
        time,
        isEmergency: !!isEmergency,
        conversationId,
        // Phase 5: patient communication preferences (spec §19) — default to
        // opted-in (transactional appointment notifications) unless the
        // patient explicitly declined; never guessed otherwise.
        ...(smsOptIn === false ? { smsOptIn: false } : {}),
        ...(emailOptIn === false ? { emailOptIn: false } : {}),
        ...(language === 'ur' ? { language: 'ur' } : {}),
      });

      res.json({
        success: true,
        message: 'Appointment booked successfully',
        data: patientView(appointment),
        // Surfaced at the top level as well as inside `data` because this is
        // the only time the patient is ever shown it, and losing it means
        // losing self-service access to their own appointment.
        bookingReference: appointment.bookingReference,
        clinic: { name: req.practice.name, phone: req.practice.phone, address: req.practice.address },
      });
    } catch (error) {
      handleAppointmentError(error, res, 'Failed to book appointment');
    }
  });

  /**
   * Returning-patient recovery: phone + booking reference.
   *
   * POST, not GET, so the reference does not end up in server access logs,
   * browser history or a Referer header the way a query string does.
   */
  router.post('/appointments/lookup', enforceMaxLengths(['phone']), async (req, res) => {
    try {
      const { phone, reference } = req.body || {};
      if (!phone || !reference) {
        return res.status(400).json({ error: 'phone and reference are both required' });
      }

      if (limiter.isLocked(req.practiceId, phone)) {
        return res.status(429).json({
          error: 'Too many attempts. Please wait a few minutes, or call the clinic and our team can look this up for you.',
          retryAfterSeconds: limiter.lockoutRemainingSeconds(req.practiceId, phone),
        });
      }

      // Rejected before any database work: a malformed reference can never
      // match, and spending a query on it just makes the endpoint cheaper
      // to hammer.
      if (!normalizeBookingReference(reference)) {
        limiter.recordFailure(req.practiceId, phone);
        return res.status(404).json({ error: ACCESS_DENIED });
      }

      const appointment = await t.lookup_appointment_for_patient(req.practice, phone, reference);
      if (!appointment) {
        limiter.recordFailure(req.practiceId, phone);
        return res.status(404).json({ error: ACCESS_DENIED });
      }

      limiter.recordSuccess(req.practiceId, phone);
      res.json({ success: true, data: patientView(appointment) });
    } catch (error) {
      console.error('Appointment lookup failed:', error);
      res.status(500).json({ error: 'Failed to look up appointment' });
    }
  });

  /** Shared ownership gate for the two change routes below. */
  async function requireBookingReference(req, res) {
    const reference = req.body?.reference || header(req, 'X-Booking-Reference');
    if (!reference) {
      res.status(400).json({ error: 'reference is required to change an appointment' });
      return null;
    }

    const appointment = await t.verify_patient_appointment_access(req.practice, req.params.id, reference);
    if (!appointment) {
      res.status(404).json({ error: ACCESS_DENIED });
      return null;
    }
    return appointment;
  }

  // Reschedule an existing appointment.
  router.patch('/appointments/:id', async (req, res) => {
    try {
      const { date, time, conversationId } = req.body || {};
      if (!date && !time) {
        return res.status(400).json({ error: 'date and/or time is required' });
      }

      const owned = await requireBookingReference(req, res);
      if (!owned) return;

      const appointment = await t.reschedule_appointment(req.practice, req.params.id, { date, time, conversationId });
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      res.json({ success: true, message: 'Appointment rescheduled successfully', data: patientView(appointment) });
    } catch (error) {
      handleAppointmentError(error, res, 'Failed to reschedule appointment');
    }
  });

  // Cancel an appointment (soft-delete: keep the record, mark status).
  router.delete('/appointments/:id', async (req, res) => {
    try {
      const owned = await requireBookingReference(req, res);
      if (!owned) return;

      const { conversationId } = req.body || {};
      const appointment = await t.cancel_appointment(req.practice, req.params.id, { conversationId });
      if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

      res.json({ success: true, message: 'Appointment cancelled successfully', data: patientView(appointment) });
    } catch (error) {
      handleAppointmentError(error, res, 'Failed to cancel appointment');
    }
  });

  return router;
}

module.exports = buildAppointmentsRouter();
module.exports.buildAppointmentsRouter = buildAppointmentsRouter;
