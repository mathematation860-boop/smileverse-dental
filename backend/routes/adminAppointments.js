/**
 * Admin appointments view (Phase 3 §7).
 *
 * Every route here is mounted behind requireAuth (see server.js), so
 * req.practice is already scoped to the authenticated admin's own
 * practice. This deliberately calls the SAME provider/tools functions the
 * public booking flow and the AI use — getAppointmentProvider(...).getAllAppointments()
 * for listing, tools.reschedule_appointment / tools.cancel_appointment for
 * actions — so there is exactly one implementation of "what a
 * reschedule/cancel means" in this codebase (demo vs Google Calendar,
 * notifications, analytics logging all happen exactly as they do today),
 * per requirement #7 ("do not duplicate appointment logic").
 */

const express = require('express');
const tools = require('../tools/receptionistTools');
const { requireAuth } = require('../middleware/authMiddleware');
const { getAppointmentProvider } = require('../services/providers');
const { handleAppointmentError } = require('../utils/appointmentErrorResponse');

const router = express.Router();
router.use(requireAuth());

// GET /api/admin/appointments -> every appointment for THIS practice only.
router.get('/admin/appointments', async (req, res) => {
  try {
    const provider = getAppointmentProvider(req.practice);
    const appointments = await provider.getAllAppointments(req.practice);
    res.json(appointments);
  } catch (error) {
    console.error('Admin appointments fetch failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// PATCH /api/admin/appointments/:id -> reschedule (same tool the AI/booking flow uses).
router.patch('/admin/appointments/:id', async (req, res) => {
  try {
    const { date, time } = req.body || {};
    if (!date && !time) {
      return res.status(400).json({ error: 'date and/or time is required' });
    }
    // tools.reschedule_appointment scopes through the provider, which
    // itself scopes every DB query by practiceId — an admin for practice A
    // can never reschedule an appointment id that belongs to practice B,
    // the same isolation guarantee the public route already has.
    const appointment = await tools.reschedule_appointment(req.practice, req.params.id, { date, time });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true, data: appointment });
  } catch (error) {
    handleAppointmentError(error, res, 'Failed to reschedule appointment');
  }
});

// DELETE /api/admin/appointments/:id -> cancel (same tool the AI/booking flow uses).
router.delete('/admin/appointments/:id', async (req, res) => {
  try {
    const appointment = await tools.cancel_appointment(req.practice, req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ success: true, data: appointment });
  } catch (error) {
    handleAppointmentError(error, res, 'Failed to cancel appointment');
  }
});

module.exports = router;
