/**
 * Mock scheduling / availability layer — practice-aware and
 * timezone-aware.
 *
 * There is no real practice-management system (PMS) or calendar behind
 * this yet, so this module generates realistic-looking availability on
 * the fly: it respects the given practice's business hours, blocks out
 * past times (evaluated in the PRACTICE's timezone, not the server's —
 * see backend/utils/timezone.js), and removes a deterministic (not
 * random-every-refresh) set of "already booked" slots so the calendar
 * doesn't look emptily perfect. It also subtracts any slots that are
 * ACTUALLY booked (passed in via `bookedTimes`), so once a demo
 * appointment is booked through this app, that slot really disappears.
 *
 * This is exactly the logic DemoAppointmentProvider (see
 * services/providers/DemoAppointmentProvider.js) exposes through the
 * AppointmentProvider interface. Swapping a practice onto a real
 * PMS/calendar API later means writing a new provider that implements
 * that same interface — this file would simply stop being called for
 * that practice.
 */

const { todayInTimezone, getMinutesSinceMidnightInTimezone } = require('../utils/timezone');

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

/** Inverse of minutesToLabel: '10:30 AM' -> 630. Returns null if unparseable. */
function labelToMinutes(label) {
  if (!label) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim());
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]);
  const ampm = match[3].toUpperCase();
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  if (ampm === 'AM') h = h === 12 ? 0 : h;
  else h = h === 12 ? 12 : h + 12;
  return h * 60 + m;
}

/** '630' minutes -> '10:30' 24-hour "HH:mm", matching practice.hours format. */
function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Weekday (0=Sun..6=Sat) of a 'YYYY-MM-DD' string. Weekday is a property of
 * the calendar date itself, so this deliberately does NOT go through any
 * timezone conversion (that would risk shifting the date at extreme UTC
 * offsets) — only Date.UTC on the literal Y/M/D components. */
function weekdayOfDateString(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Is this date (YYYY-MM-DD) a day the practice is open? */
function isOpenDay(practice, dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  return practice.hours.openDays.includes(weekdayOfDateString(dateStr));
}

/** Generate the full list of slot start times (in minutes-from-midnight) for one open day. */
function allDaySlotMinutes(practice) {
  const { openTime, closeTime, slotMinutes } = practice.hours;
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
 *  - past times (if the date is "today" IN THE PRACTICE'S TIMEZONE)
 *  - a deterministic mock "already booked" subset (so it looks realistic)
 *  - real appointments booked through this app, if bookedTimes is passed in
 */
function getAvailableSlots(practice, dateStr, { bookedTimes = [] } = {}) {
  if (!dateStr || !isOpenDay(practice, dateStr)) return [];

  const timezone = practice.timezone;
  const isToday = dateStr === todayInTimezone(timezone);
  const nowMinutes = getMinutesSinceMidnightInTimezone(new Date(), timezone);

  const seed = hashString(`${practice.practiceId}:${dateStr}`);
  const allSlots = allDaySlotMinutes(practice);
  const bookedLabels = new Set(bookedTimes);

  const available = allSlots.filter((mins, idx) => {
    const label = minutesToLabel(mins);

    // Exclude past slots for today (with a small buffer), in the PRACTICE's timezone.
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

/** Next N open dates starting today IN THE PRACTICE'S TIMEZONE (inclusive), as YYYY-MM-DD strings. */
function nextOpenDates(practice, count = 14) {
  const dates = [];
  const todayStr = todayInTimezone(practice.timezone);
  const [y, m, d] = todayStr.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  let guard = 0;
  while (dates.length < count && guard < count * 4) {
    const dateStr = cursor.toISOString().slice(0, 10);
    if (isOpenDay(practice, dateStr)) dates.push(dateStr);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return dates;
}

module.exports = {
  isOpenDay,
  getAvailableSlots,
  nextOpenDates,
  minutesToLabel,
  weekdayOfDateString,
  // Exported for Phase 2's real-calendar provider (services/providers/
  // GoogleCalendarAppointmentProvider.js), which needs the raw slot grid
  // and label<->minutes conversions to reason about real busy intervals —
  // the mock provider above only ever needed the already-composed
  // getAvailableSlots().
  allDaySlotMinutes,
  labelToMinutes,
  minutesToHHMM,
};
