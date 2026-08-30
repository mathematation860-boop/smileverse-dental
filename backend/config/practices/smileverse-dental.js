/**
 * Practice record for SmileVerse Dental.
 *
 * This is the demo/seed practice. Every field a route or the AI needs
 * about "this clinic" lives on this one object — nothing about a specific
 * practice should be hard-coded anywhere else in the app. A second
 * practice is added by creating another file like this one (see
 * ../practiceRepository.js) with a different `practiceId`; nothing else
 * in the codebase needs to change.
 */

const faqCategories = require('../faqs');
const insuranceConfig = require('../insurance');

const practice = {
  practiceId: 'smileverse-dental',

  // Demo/product mode flag. true = this practice runs entirely on mock
  // data (no real calendar/PMS/SMS/email provider connected yet). Surfaced
  // via GET /api/practice-config so the frontend can show a small,
  // unobtrusive "Demo" indicator instead of silently pretending to be live.
  demoMode: true,

  name: 'SmileVerse Dental',
  tagline: 'Caring for your smile, one visit at a time',
  phone: '+1-555-SMILE-01',
  email: 'info@smileverse.com',
  address: '123 Dental Lane, Smile City, SC 12345',
  website: 'https://www.smileverse.com',

  // IANA timezone name. ALL availability/scheduling math for this practice
  // happens in this timezone (see backend/utils/timezone.js) — never the
  // server's own local time, and never assumed to be Pakistan time just
  // because this demo happens to be operated from Pakistan.
  timezone: 'America/New_York',

  hours: {
    display: '9:00 AM - 5:00 PM (Monday-Friday)',
    displayUr: 'پیر سے جمعہ، صبح 9 بجے سے شام 5 بجے تک',
    // 0 = Sunday ... 6 = Saturday, evaluated in `timezone` above.
    openDays: [1, 2, 3, 4, 5],
    openTime: '09:00',
    closeTime: '17:00',
    slotMinutes: 30,
  },

  // Services offered. `eligiblePatientTypes` controls which step-1 choice
  // (new/existing) can book this service from the booking flow; both
  // types can book everything by default here.
  services: [
    { id: 'cleaning', name: 'Cleaning', price: 150, duration: 45, description: 'Routine dental cleaning and checkup.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'consultation', name: 'Consultation', price: 0, duration: 30, description: 'General consultation to discuss concerns or treatment options.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'root_canal', name: 'Root Canal', price: 800, duration: 90, description: 'Root canal therapy for infected or damaged tooth pulp.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'whitening', name: 'Whitening', price: 200, duration: 60, description: 'Professional teeth whitening treatment.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'filling', name: 'Filling', price: 250, duration: 45, description: 'Cavity filling using tooth-colored composite material.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'extraction', name: 'Extraction', price: 300, duration: 30, description: 'Tooth extraction, including wisdom teeth.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'crown', name: 'Crown', price: 1200, duration: 120, description: 'Custom dental crown placement.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'emergency', name: 'Emergency', price: null, duration: 30, description: 'Urgent dental care for pain, trauma, or infection. Priced after evaluation.', eligiblePatientTypes: ['new', 'existing'] },
    { id: 'other', name: 'Other', price: null, duration: 30, description: "Anything not listed above — our team will follow up to confirm details.", eligiblePatientTypes: ['new', 'existing'] },
  ],

  cancellationPolicy: {
    summary: 'Appointments can be cancelled or rescheduled free of charge up to 24 hours before the appointment time.',
    summaryUr: 'اپائنٹمنٹ سے 24 گھنٹے پہلے تک منسوخی یا تاریخ کی تبدیلی مفت ہے۔',
  },

  emergencyPolicy: {
    summary:
      'For urgent dental issues (severe pain, swelling, trauma, uncontrolled bleeding) we hold same-day emergency slots. ' +
      'For medical emergencies such as difficulty breathing or swallowing, chest pain, or heavy uncontrolled bleeding, call 911 ' +
      '(or your local emergency number) or go to the nearest emergency room immediately — do not wait for a callback.',
    emergencyServiceId: 'emergency',
  },

  faqs: faqCategories,
  insurance: insuranceConfig,

  // Which provider adapter serves each capability for THIS practice. Every
  // value here is 'demo'/'mock' today because no real credentials exist
  // yet — see backend/services/providers and backend/services/notifications.
  // Swapping a practice onto a real calendar/PMS/SMS provider later is a
  // one-line change here, not a rewrite of any route.
  integrations: {
    calendarProvider: 'demo', // e.g. future: 'google_calendar' | 'dentrix' | 'curve'
    pmsProvider: 'none', // e.g. future: 'dentrix' | 'opendental'
    emailProvider: 'mock', // e.g. future: 'sendgrid' | 'resend'
    smsProvider: 'mock', // e.g. future: 'twilio'
    aiProvider: 'gemini',
    // Phase 4: which TelephonyProvider services/voice/index.js hands back
    // for this practice. Exactly like the other integration keys above,
    // this only matters when `demoMode: false` (see services/voice/index.js
    // and services/practice/practiceMerge.js — `integrations` can never be
    // changed from the admin dashboard, only by editing this file).
    voiceProvider: 'mock', // e.g. future: 'twilio'
  },

  // Phase 4: which phone number routes an incoming call to THIS practice
  // (see config/practiceRepository.js's getPracticeIdForPhoneNumber() and
  // middleware/voicePracticeContext.js). Deliberately sourced from an env
  // var, never hard-coded — a real Twilio number is assigned per
  // deployment, not baked into source. Left null until that env var is
  // set, which is exactly what keeps voice calls a no-op for this practice
  // until someone deliberately configures a real number (spec §3/§24: no
  // invented credentials, safe by default).
  voice: {
    phoneNumber: process.env.SMILEVERSE_VOICE_PHONE_NUMBER || null,
  },

  // Phase 5: SMS/email notification configuration for THIS practice.
  // `smsEnabled`/`emailEnabled`/`reminderOffsetsHours` are admin-overridable
  // (see services/practice/practiceMerge.js) — a practice can turn a whole
  // channel off or change reminder lead time from the dashboard.
  // `smsPhoneNumber` follows the same never-admin-overridable rule as
  // `voice.phoneNumber` above, for the identical reason: it identifies
  // which of THIS deployment's numbers inbound patient texts arrive on
  // (see config/practiceRepository.js's getPracticeIdForPhoneNumber and
  // middleware/smsPracticeContext.js) — an admin being able to edit it
  // could let one practice's dashboard redirect another practice's texts.
  // `clinicAlertPhone`/`clinicAlertEmail` are where STAFF (not patients)
  // are notified of a human handoff/emergency (spec §15/§16); left unset
  // here so notificationService.js falls back to this practice's own
  // public phone/email.
  notifications: {
    smsEnabled: true,
    emailEnabled: true,
    reminderOffsetsHours: [24], // architecture supports more than one, e.g. [48, 24, 2] — see services/notifications/reminderScheduler.js
    smsPhoneNumber: process.env.SMILEVERSE_SMS_PHONE_NUMBER || null,
    clinicAlertPhone: null,
    clinicAlertEmail: null,
  },

  // Phase 6: Open Dental PMS configuration for THIS practice. Left at its
  // safe MVP defaults — `integrations.pmsProvider: 'none'` above means
  // this whole block is inert (services/providers/index.js's factory
  // never even looks at it) until a deliberate code change turns PMS on
  // for a specific practice. `apiBaseUrl`/credentials are never stored
  // here — see services/pms/OpenDentalPMSProvider.js and .env.example
  // for why (server-side env vars only, spec §4/§21).
  //
  // `serviceMappings`/`providerMappings`/`operatoryMappings` ARE
  // admin-overridable from the dashboard (see
  // services/practice/practiceMerge.js) — they're not secrets, just
  // numeric ID lookups a clinic's front-desk staff would fill in after
  // checking their own Open Dental setup. Left empty here (spec §11:
  // "if a mapping is missing, do not guess — tell the patient the clinic
  // needs to confirm, or hand off").
  pms: {
    openDental: {
      // Overridable ONLY by an env var, never by this file being edited
      // per-deployment or by the admin dashboard — see .env.example.
      apiBaseUrl: process.env.OPENDENTAL_API_BASE_URL || 'https://api.opendental.com/api/v1',
      clinicNum: process.env.OPENDENTAL_CLINIC_NUM || null,
    },
    // e.g. { cleaning: { openDentalAppointmentTypeNum: '123' }, consultation: { openDentalAppointmentTypeNum: '124' } }
    serviceMappings: {},
    // e.g. { default: { openDentalProvNum: '1' } } — omitted entirely means
    // "ask the PMS's own provider directory and use its first entry."
    providerMappings: {},
    operatoryMappings: {},
  },

  // NOTE: This is a demo/prototype product. Do not claim HIPAA compliance
  // or any regulatory certification unless the real infrastructure behind
  // it has actually been reviewed and certified for that. See
  // docs/DATA_MODEL.md and README.md for what real compliance would need.
  compliance: {
    hipaaCompliant: false,
  },
};

module.exports = practice;
