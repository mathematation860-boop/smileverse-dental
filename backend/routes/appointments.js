const express = require('express');
const tools = require('../tools/receptionistTools');
const { requireFields, enforceMaxLengths } = require('../middleware/validate');
const { getAppointmentProvider } = require('../services/providers');
const { handleAppointmentError } = require('../utils/appointmentErrorResponse');

const router = express.Router();

// Book a new appointment.
router.post('/appointments', enforceMaxLengths(['name', 'phone', 'email']), async (req, res) => {
  try {
    const missing = requireFields(req.body, ['name', 'phone', 'service', 'date']);
    if (missing) return res.status(400).json({ error: missing });

    const { name, phone, email, service, serviceId, patientType, reason, date, time, isEmergency, conversationId } = req.body;

    const appointment = await tools.create_appointment(req.practice, {
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
    });

    res.json({
      success: true,
      message: 'Appointment booked successfully',
      data: appointment,
      clinic: { name: req.practice.name, phone: req.practice.phone, address: req.practice.address },
    });
  } catch (error) {
    handleAppointmentError(error, res, 'Failed to book appointment');
  }
});

router.get('/appointments', async (req, res) => {
  try {
    const provider = getAppointmentProvider(req.practice);
    const appointments = await provider.getAllAppointments(req.practice);
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

// Look up a patient's appointments by phone, for reschedule/cancel-by-chat flows.
router.get('/appointments/search', async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const appointments = await tools.search_appointments(req.practice, phone);
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to search appointments' });
  }
});

// Reschedule an existing appointment.
router.patch('/appointments/:id', async (req, res) => {
  try {
    const { date, time, conversationId } = req.body;
    if (!date && !time) {
      return res.status(400).json({ error: 'date and/or time is required' });
    }
    const appointment = await tools.reschedule_appointment(req.practice, req.params.id, { date, time, conversationId });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    res.json({ success: true, message: 'Appointment rescheduled successfully', data: appointment });
  } catch (error) {
    handleAppointmentError(error, res, 'Failed to reschedule appointment');
  }
});

// Cancel an appointment (soft-delete: keep the record, mark status).
router.delete('/appointments/:id', async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    const appointment = await tools.cancel_appointment(req.practice, req.params.id, { conversationId });
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    res.json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
  } catch (error) {
    handleAppointmentError(error, res, 'Failed to cancel appointment');
  }
});

module.exports = router;
