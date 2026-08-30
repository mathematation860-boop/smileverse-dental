const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
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
  // Phase 2 (Google Calendar): set only when this appointment has a real
  // calendar event backing it. 'demo' (or missing, for pre-Phase-2 rows)
  // means it only ever lived in this database — never a real calendar.
  calendarEventId: { type: String, default: null },
  calendarProvider: { type: String, enum: ['demo', 'google'], default: 'demo' },
});

// Every availability lookup filters by practiceId + date — index the pair.
appointmentSchema.index({ practiceId: 1, date: 1 });
appointmentSchema.index({ practiceId: 1, phone: 1 });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
