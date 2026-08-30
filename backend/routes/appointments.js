const express = require('express');
const Appointment = require('../models/Appointment');
const analyticsService = require('../services/analyticsService');
const practiceConfig = require('../config/practiceConfig');

const router = express.Router();

// Book a new appointment.
router.post('/appointments', async (req, res) => {
  try {
    const { name, phone, email, service, serviceId, patientType, reason, date, time, isEmergency, conversationId } = req.body;
    if (!name || !phone || !service || !date) {
      return res.status(400).json({ error: 'Required fields missing (name, phone, service, date)' });
    }

    const newAppointment = new Appointment({
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
    });
    await newAppointment.save();

    await analyticsService.logEvent('appointment_booked', conversationId, {
      serviceId,
      date,
      time,
      isEmergency: !!isEmergency,
    });

    res.json({
      success: true,
      message: 'Appointment booked successfully',
      data: newAppointment,
      clinic: { name: practiceConfig.name, phone: practiceConfig.phone, address: practiceConfig.address },
    });
  } catch (error) {
    console.error('Book Appointment Error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

router.get('/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ confirmedAt: -1 });
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
    const appointments = await Appointment.find({ phone, status: { $ne: 'Cancelled' } }).sort({ confirmedAt: -1 });
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
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    if (date) appointment.date = date;
    if (time) appointment.time = time;
    appointment.status = 'Rescheduled';
    appointment.updatedAt = new Date();
    await appointment.save();

    await analyticsService.logEvent('appointment_rescheduled', conversationId, { id: appointment._id, date, time });

    res.json({ success: true, message: 'Appointment rescheduled successfully', data: appointment });
  } catch (error) {
    console.error('Reschedule Error:', error);
    res.status(500).json({ error: 'Failed to reschedule appointment' });
  }
});

// Cancel an appointment (soft-delete: keep the record, mark status).
router.delete('/appointments/:id', async (req, res) => {
  try {
    const { conversationId } = req.body || {};
    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return res.status(404).json({ error: 'Appointment not found' });

    appointment.status = 'Cancelled';
    appointment.updatedAt = new Date();
    await appointment.save();

    await analyticsService.logEvent('appointment_cancelled', conversationId, { id: appointment._id });

    res.json({ success: true, message: 'Appointment cancelled successfully', data: appointment });
  } catch (error) {
    console.error('Cancel Error:', error);
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

module.exports = router;
