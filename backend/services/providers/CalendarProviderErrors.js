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

const BOOKING_NOT_RECORDED_MESSAGE_EN =
  "I couldn't complete that booking, so nothing has been reserved. Please try again, or I can connect you with our front desk team.";
const BOOKING_NOT_RECORDED_MESSAGE_UR =
  'میں یہ بکنگ مکمل نہیں کر سکا، اس لیے کچھ بھی محفوظ نہیں ہوا۔ براہ کرم دوبارہ کوشش کریں، یا میں آپ کو فرنٹ ڈیسک ٹیم سے ملوا سکتا ہوں۔';

const BOOKING_UNCERTAIN_MESSAGE_EN =
  "I couldn't confirm whether that time was held. Please call the clinic to check before assuming it is or isn't booked — don't rebook until they confirm.";
const BOOKING_UNCERTAIN_MESSAGE_UR =
  'میں تصدیق نہیں کر سکا کہ وہ وقت محفوظ ہوا یا نہیں۔ براہ کرم کلینک کو کال کر کے تصدیق کریں — تصدیق سے پہلے دوبارہ بکنگ نہ کریں۔';

/**
 * The calendar accepted the event but the local record could not be
 * written, AND the event was successfully removed again.
 *
 * "Nothing has been reserved" is only honest in that case, which is why it
 * is a separate class from BookingOutcomeUncertainError below. From the
 * clinic's point of view the booking did not happen: nothing shows in the
 * dashboard, no reminder is sent, and no one can find it by phone.
 */
class BookingNotRecordedError extends Error {
  constructor({ reason, cause } = {}) {
    super(BOOKING_NOT_RECORDED_MESSAGE_EN);
    this.name = 'BookingNotRecordedError';
    this.reason = reason || 'persist_failed';
    this.cause = cause;
    this.booked = false;
  }
}

/**
 * We genuinely do not know whether the patient has an appointment.
 *
 * Two ways to get here, and both used to be reported as a flat failure:
 *   - the calendar insert timed out twice, so the event may exist;
 *   - the event was created, the database write failed, and the attempt to
 *     remove the event ALSO failed, so a real event is sitting on the
 *     clinic's calendar with no record behind it.
 *
 * Telling the patient "nothing has been reserved" in either case is a
 * guess dressed as a fact, and it is the dangerous direction to guess in:
 * they rebook, and the clinic ends up with a blocked slot plus a duplicate.
 * `orphanedCalendarEventId` is carried and logged when known, because a
 * silently blocked slot is the kind of fault a clinic finds weeks later.
 */
class BookingOutcomeUncertainError extends Error {
  constructor({ reason, cause, orphanedCalendarEventId } = {}) {
    super(BOOKING_UNCERTAIN_MESSAGE_EN);
    this.name = 'BookingOutcomeUncertainError';
    this.reason = reason || 'outcome_unknown';
    this.cause = cause;
    this.orphanedCalendarEventId = orphanedCalendarEventId || null;
    this.booked = 'unknown';
    this.needsReconciliation = true;
  }
}

const CHANGE_NOT_RECORDED_MESSAGE_EN =
  "I've updated the clinic's calendar but couldn't update our records, so please call the front desk to confirm this change.";
const CHANGE_NOT_RECORDED_MESSAGE_UR =
  'میں نے کلینک کا کیلنڈر اپ ڈیٹ کر دیا ہے لیکن ہمارا ریکارڈ اپ ڈیٹ نہیں ہو سکا، براہ کرم اس تبدیلی کی تصدیق کے لیے فرنٹ ڈیسک کو کال کریں۔';

/**
 * A cancellation or reschedule that changed the real calendar but failed
 * to update the local record. It cannot be rolled back honestly — the
 * event is already deleted or moved, and re-creating it would invent a new
 * id and a new source of drift — so the message says the two systems
 * disagree instead of claiming either success or failure.
 */
class ChangeNotRecordedError extends Error {
  constructor({ operation, cause, calendarEventId } = {}) {
    super(CHANGE_NOT_RECORDED_MESSAGE_EN);
    this.name = 'ChangeNotRecordedError';
    this.reason = 'local_record_not_updated';
    this.operation = operation || 'change';
    this.cause = cause;
    this.calendarEventId = calendarEventId || null;
    this.needsReconciliation = true;
  }
}

module.exports = {
  CalendarUnavailableError,
  SlotUnavailableError,
  BookingNotRecordedError,
  BookingOutcomeUncertainError,
  ChangeNotRecordedError,
  BOOKING_NOT_RECORDED_MESSAGE_EN,
  BOOKING_NOT_RECORDED_MESSAGE_UR,
  BOOKING_UNCERTAIN_MESSAGE_EN,
  BOOKING_UNCERTAIN_MESSAGE_UR,
  CHANGE_NOT_RECORDED_MESSAGE_EN,
  CHANGE_NOT_RECORDED_MESSAGE_UR,
  CALENDAR_UNAVAILABLE_MESSAGE_EN,
  CALENDAR_UNAVAILABLE_MESSAGE_UR,
  SLOT_UNAVAILABLE_MESSAGE_EN,
  SLOT_UNAVAILABLE_MESSAGE_UR,
};
