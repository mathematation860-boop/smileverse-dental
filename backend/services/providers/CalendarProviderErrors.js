/**
 * Typed errors + the exact patient-facing fallback text for real-calendar
 * failures (Phase 2). Kept in one place — like emergencyService.js's
 * message constants — so the route layer, the tools layer, and tests all
 * reference the SAME string instead of three hand-typed copies drifting
 * apart.
 *
 * Two distinct failure shapes matter here, and callers should treat them
 * differently:
 *  - CalendarUnavailableError: we could not even ask Google whether a
 *    slot is free (no connection configured yet, auth/token failure,
 *    network/API error). Nothing about the request was necessarily wrong.
 *  - SlotUnavailableError: we successfully asked, and the answer is "no"
 *    — the requested time is outside business hours, on a closed day, or
 *    already busy on the real calendar. This is a normal, expected
 *    outcome (not a system failure) and gets a more specific message.
 */

const CALENDAR_UNAVAILABLE_MESSAGE_EN =
  "Sorry, I'm having trouble checking live availability right now. I can connect you with our front desk team.";
const CALENDAR_UNAVAILABLE_MESSAGE_UR =
  'معذرت، ابھی لائیو دستیابی چیک کرنے میں مشکل ہو رہی ہے۔ میں آپ کو ہماری فرنٹ ڈیسک ٹیم سے ملوا سکتا ہوں۔';

const SLOT_UNAVAILABLE_MESSAGE_EN =
  "That time is no longer available. Please choose another time — I can show you what's actually open.";
const SLOT_UNAVAILABLE_MESSAGE_UR =
  'یہ وقت اب دستیاب نہیں ہے۔ براہ کرم کوئی اور وقت منتخب کریں — میں آپ کو دستیاب اوقات دکھا سکتا ہوں۔';

class CalendarUnavailableError extends Error {
  constructor(reason, cause) {
    super(CALENDAR_UNAVAILABLE_MESSAGE_EN);
    this.name = 'CalendarUnavailableError';
    this.reason = reason || 'unknown'; // e.g. 'not_connected', 'auth_failed', 'api_error'
    this.cause = cause;
  }
}

class SlotUnavailableError extends Error {
  constructor(reason) {
    super(SLOT_UNAVAILABLE_MESSAGE_EN);
    this.name = 'SlotUnavailableError';
    this.reason = reason || 'busy'; // e.g. 'busy', 'outside_hours', 'closed_day'
  }
}

module.exports = {
  CalendarUnavailableError,
  SlotUnavailableError,
  CALENDAR_UNAVAILABLE_MESSAGE_EN,
  CALENDAR_UNAVAILABLE_MESSAGE_UR,
  SLOT_UNAVAILABLE_MESSAGE_EN,
  SLOT_UNAVAILABLE_MESSAGE_UR,
};
