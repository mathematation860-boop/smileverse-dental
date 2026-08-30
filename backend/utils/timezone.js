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

/**
 * The UTC offset of `timeZone`, in minutes, AT the instant `utcInstant`
 * represents (so it's correct across a DST transition, not just for the
 * zone's "usual" offset). Positive means the zone is ahead of UTC.
 *
 * Added for Phase 2 (Google Calendar): converting a practice's local wall
 * clock time ("2026-09-05" + "10:00 AM" in America/New_York) into the
 * exact UTC instant Google Calendar's API needs requires knowing this
 * offset at that specific date, not a hard-coded "-5" or "-4".
 */
function getTimezoneOffsetMinutes(timeZone, utcInstant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
    .formatToParts(utcInstant)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  // "What the wall clock reads in timeZone" re-interpreted as if it were
  // itself UTC, minus the real UTC instant, gives the zone's offset.
  const wallClockAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((wallClockAsUtc - utcInstant.getTime()) / 60000);
}

/**
 * Converts a practice's local wall-clock date+time into the exact UTC
 * `Date` instant it represents in `timeZone` — e.g. '2026-01-15' + '10:00'
 * in 'America/New_York' (EST, UTC-5) -> 2026-01-15T15:00:00.000Z.
 * Correctly handles DST by re-checking the offset at the first guess and
 * correcting once if the transition changed it (covers the transition day
 * itself; a slot literally inside the "spring forward" gap is treated
 * using the post-transition offset, which is the practical, safe choice
 * for a business-hours booking system).
 *
 * `hhmm24` is 24-hour "HH:mm" (e.g. '14:30'), matching practice.hours'
 * openTime/closeTime format.
 */
function zonedWallTimeToUtc(dateStr, hhmm24, timeZone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = hhmm24.split(':').map(Number);

  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const offset1 = getTimezoneOffsetMinutes(timeZone, guess);
  const corrected = new Date(guess.getTime() - offset1 * 60000);

  const offset2 = getTimezoneOffsetMinutes(timeZone, corrected);
  if (offset2 !== offset1) {
    return new Date(guess.getTime() - offset2 * 60000);
  }
  return corrected;
}

module.exports = {
  toDateStringInTimezone,
  getWeekdayInTimezone,
  getMinutesSinceMidnightInTimezone,
  todayInTimezone,
  getTimezoneOffsetMinutes,
  zonedWallTimeToUtc,
};
