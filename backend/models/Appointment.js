const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  service: String,
  serviceId: String,
  patientType: { type: String, enum: ['new', 'existing'], default: 'new' },
  reason: String,
  date: String, // YYYY-MM-DD
  time: String, // e.g. '10:30 AM'
  status: { type: String, enum: ['Confirmed', 'Rescheduled', 'Cancelled'], default: 'Confirmed' },
  isEmergency: { type: Boolean, default: false },
  confirmedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
