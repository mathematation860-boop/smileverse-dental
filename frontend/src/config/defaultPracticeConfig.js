/**
 * Fallback config used before /api/practice-config resolves (or if the
 * backend is briefly unreachable). Mirrors the shape of
 * backend/config/practiceConfig.js — kept intentionally small since the
 * backend is the real source of truth.
 */
const defaultPracticeConfig = {
  name: 'SmileVerse Dental',
  tagline: 'Caring for your smile, one visit at a time',
  hours: { display: '9 AM - 5 PM (Monday-Friday)' },
  services: [
    { id: 'cleaning', name: 'Cleaning', price: 150, duration: 45 },
    { id: 'root_canal', name: 'Root Canal', price: 800, duration: 90 },
    { id: 'whitening', name: 'Whitening', price: 200, duration: 60 },
    { id: 'filling', name: 'Filling', price: 250, duration: 45 },
    { id: 'extraction', name: 'Extraction', price: 300, duration: 30 },
    { id: 'crown', name: 'Crown', price: 1200, duration: 120 },
  ],
  address: '123 Dental Lane, Smile City, SC 12345',
  phone: '+1-555-SMILE-01',
  email: 'info@smileverse.com',
};

export const BOOKING_REASONS = [
  { id: 'cleaning', name: 'Cleaning' },
  { id: 'consultation', name: 'Consultation' },
  { id: 'tooth_pain', name: 'Tooth Pain' },
  { id: 'filling', name: 'Filling' },
  { id: 'root_canal', name: 'Root Canal' },
  { id: 'whitening', name: 'Whitening' },
  { id: 'extraction', name: 'Extraction' },
  { id: 'crown', name: 'Crown' },
  { id: 'emergency', name: 'Emergency' },
  { id: 'other', name: 'Other' },
];

export default defaultPracticeConfig;
