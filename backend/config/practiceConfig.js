/**
 * Centralized practice configuration.
 *
 * This is the single source of truth for everything that describes THIS
 * dental practice: contact info, hours, services, insurance, FAQs and
 * policies. Nothing below should be duplicated or hard-coded elsewhere in
 * the backend (system prompts, routes, etc. all read from here).
 *
 * To reuse this product for a different clinic, this is the only file
 * that needs to change (plus the FAQ/insurance config files next to it).
 * A future admin dashboard should be able to read + write this same shape
 * from a database instead of a static file, without touching any route
 * or service code.
 */

const practiceConfig = {
  name: 'SmileVerse Dental',
  tagline: 'Caring for your smile, one visit at a time',
  phone: '+1-555-SMILE-01',
  email: 'info@smileverse.com',
  address: '123 Dental Lane, Smile City, SC 12345',
  website: 'https://www.smileverse.com',
  timezone: 'America/New_York',

  hours: {
    display: '9:00 AM - 5:00 PM (Monday-Friday)',
    displayUr: 'پیر سے جمعہ، صبح 9 بجے سے شام 5 بجے تک',
    // 0 = Sunday ... 6 = Saturday. Used by the availability service.
    openDays: [1, 2, 3, 4, 5],
    openTime: '09:00',
    closeTime: '17:00',
    slotMinutes: 30,
  },

  // Services offered. `eligiblePatientTypes` controls which step-1 choice
  // (new/existing) can book this service from the booking flow; both
  // types can book everything by default here.
  services: [
    {
      id: 'cleaning',
      name: 'Cleaning',
      price: 150,
      duration: 45,
      description: 'Routine dental cleaning and checkup.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'consultation',
      name: 'Consultation',
      price: 0,
      duration: 30,
      description: 'General consultation to discuss concerns or treatment options.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'root_canal',
      name: 'Root Canal',
      price: 800,
      duration: 90,
      description: 'Root canal therapy for infected or damaged tooth pulp.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'whitening',
      name: 'Whitening',
      price: 200,
      duration: 60,
      description: 'Professional teeth whitening treatment.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'filling',
      name: 'Filling',
      price: 250,
      duration: 45,
      description: 'Cavity filling using tooth-colored composite material.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'extraction',
      name: 'Extraction',
      price: 300,
      duration: 30,
      description: 'Tooth extraction, including wisdom teeth.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'crown',
      name: 'Crown',
      price: 1200,
      duration: 120,
      description: 'Custom dental crown placement.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'emergency',
      name: 'Emergency',
      price: null,
      duration: 30,
      description: 'Urgent dental care for pain, trauma, or infection. Priced after evaluation.',
      eligiblePatientTypes: ['new', 'existing'],
    },
    {
      id: 'other',
      name: 'Other',
      price: null,
      duration: 30,
      description: 'Anything not listed above — our team will follow up to confirm details.',
      eligiblePatientTypes: ['new', 'existing'],
    },
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

  // NOTE: This is a demo/prototype product. Do not claim HIPAA compliance
  // or any regulatory certification unless the real infrastructure behind
  // it has actually been reviewed and certified for that.
  compliance: {
    hipaaCompliant: false,
  },
};

module.exports = practiceConfig;
