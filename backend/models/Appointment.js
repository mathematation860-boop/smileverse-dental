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

  // Phase 6 (Open Dental PMS): set only when this appointment has a real
  // (or mock) PMS appointment backing it — see services/pms/pmsAppointmentProvider.js.
  // The fuller mapping (including sync status/history) lives in
  // models/PMSSyncRecord.js; these two fields are kept here too purely
  // for fast reschedule/cancel lookups, mirroring calendarEventId above.
  pmsProvider: { type: String, enum: ['mock', 'openDental', null], default: null },
  pmsAppointmentId: { type: String, default: null },
  pmsPatientId: { type: String, default: null },

  // Phase 5 (notifications): per-patient communication preferences (spec
  // §19) — default true (transactional appointment notifications, unlike
  // future marketing sends, don't require a separate opt-in beyond
  // booking the appointment itself). Explicitly false means this patient
  // asked not to be contacted on that channel; notificationService.js
  // checks this before ever attempting a send.
  smsOptIn: { type: Boolean, default: true },
  emailOptIn: { type: Boolean, default: true },
  // Which language notifications for this appointment should render in
  // (spec §14) — captured from the conversation's own detected/preferred
  // language at booking time (see tools/receptionistTools.js), never
  // guessed later. 'en' if never determined.
  language: { type: String, enum: ['en', 'ur'], default: 'en' },
});

// Every availability lookup filters by practiceId + date — index the pair.
appointmentSchema.index({ practiceId: 1, date: 1 });
appointmentSchema.index({ practiceId: 1, phone: 1 });

module.exports = mongoose.models.Appointment || mongoose.model('Appointment', appointmentSchema);
