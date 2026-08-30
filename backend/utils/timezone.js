/**
 * Timezone-aware date helpers, built on Node's native Intl support —
 * deliberately no new dependency (date-fns-tz/luxon/moment) for something
 * this contained.
 *
 * Why this exists: the previous availability logic used `new Date()` and
 * `.getDay()`/`.getHours()` directly, which read the SERVER's local
 * timezone. That's a real bug for a practice like SmileVerse Dental
 * (America/New_York) running on a server that may be deployed anywhere
 * (Railway containers typically run in UTC) — "is it currently a business
 * day" and "is this slot in the past" must be evaluated in the PRACTICE's
 * timezone, never the server's, and never assumed to be Pakistan time.
 */

/** 'YYYY-MM-DD' for `date` as seen in `timeZone`. */
function toDateStringInTimezone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date); // en-CA locale formats as YYYY-MM-DD
}

/** 0 (Sunday) - 6 (Saturday) for `date` as seen in `timeZone`. */
function getWeekdayInTimezone(date, timeZone) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekday];
}

/** Minutes since local midnight for `date` as seen in `timeZone`. */
function getMinutesSinceMidnightInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
}

/** 'YYYY-MM-DD' string for "today" in `timeZone`. */
function todayInTimezone(timeZone) {
  return toDateStringInTimezone(new Date(), timeZone);
}

module.exports = {
  toDateStringInTimezone,
  getWeekdayInTimezone,
  getMinutesSinceMidnightInTimezone,
  todayInTimezone,
};
