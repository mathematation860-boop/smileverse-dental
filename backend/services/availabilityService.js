/**
 * Mock scheduling / availability layer.
 *
 * There is no real practice-management system (PMS) or calendar behind
 * this yet, so this module generates realistic-looking availability
 * on the fly: it respects business hours from practiceConfig, blocks out
 * past times, and removes a deterministic (not random-every-refresh) set
 * of "already booked" slots so the calendar doesn't look emptily perfect.
 * It also subtracts any slots that are ACTUALLY booked in MongoDB via the
 * Appointment model, so once a demo appointment is booked through this
 * app, that slot really does disappear.
 *
 * Swapping this for a real PMS/calendar API (e.g. Dentrix, Curve, Google
 * Calendar) later should only require rewriting the functions in this
 * file — nothing else in the app should need to change, since routes and
 * the frontend only ever call getAvailableSlots()/isSlotBooked() here.
 */

const practiceConfig = require('../config/practiceConfig');

/** Simple deterministic string hash -> 32-bit int, used to seed "mock booked" slots per day. */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToLabel(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Is this date (YYYY-MM-DD) a day the practice is open? */
function isOpenDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  return practiceConfig.hours.openDays.includes(d.getDay());
}

/** Generate the full list of slot start times (in minutes-from-midnight) for one open day. */
function allDaySlotMinutes() {
  const { openTime, closeTime, slotMinutes } = practiceConfig.hours;
  const start = toMinutes(openTime);
  const end = toMinutes(closeTime);
  const slots = [];
  for (let t = start; t + slotMinutes <= end; t += slotMinutes) {
    slots.push(t);
  }
  return slots;
}

/**
 * Returns available slots for a given date (YYYY-MM-DD) as
 * [{ time: '10:00 AM', minutes: 600 }, ...], already excluding:
 *  - non-business days
 *  - past times (if the date is today)
 *  - a deterministic mock "already booked" subset (so it looks realistic)
 *  - real appointments booked through this app, if bookedTimes is passed in
 *
 * `bookedTimes` is an optional array of 'h:mm AM/PM' strings already
 * confirmed for that date (fetched from MongoDB by the caller) — kept as
 * a plain parameter here so this module has no direct DB dependency.
 */
function getAvailableSlots(dateStr, { bookedTimes = [], serviceDurationMinutes } = {}) {
  if (!dateStr || !isOpenDay(dateStr)) return [];

  const now = new Date();
  const isToday = dateStr === now.toISOString().slice(0, 10);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const seed = hashString(dateStr);
  const allSlots = allDaySlotMinutes();

  const bookedLabels = new Set(bookedTimes);

  const available = allSlots.filter((mins, idx) => {
    const label = minutesToLabel(mins);

    // Exclude past slots for today (with a small buffer).
    if (isToday && mins <= nowMinutes + 30) return false;

    // Exclude anything already really booked.
    if (bookedLabels.has(label)) return false;

    // Deterministic mock "already booked" slots: roughly a third of the
    // day looks taken, varying by date so different days look different,
    // but stable on repeated calls for the same date.
    const mockTaken = (seed + idx * 7) % 5 === 0 || (seed + idx * 13) % 8 === 0;
    if (mockTaken) return false;

    return true;
  });

  return available.map((mins) => ({ time: minutesToLabel(mins), minutes: mins }));
}

/** Next N open dates starting today (inclusive), as YYYY-MM-DD strings. */
function nextOpenDates(count = 14) {
  const dates = [];
  const cursor = new Date();
  let guard = 0;
  while (dates.length < count && guard < count * 4) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (isOpenDay(dateStr)) dates.push(dateStr);
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }
  return dates;
}

module.exports = {
  isOpenDay,
  getAvailableSlots,
  nextOpenDates,
  minutesToLabel,
};
