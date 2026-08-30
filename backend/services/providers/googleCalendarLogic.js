/**
 * Pure decision logic for the real-Google-Calendar provider — no network
 * call, no Mongoose, no `googleapis` import anywhere in this file. Given
 * a practice, a date, and a list of already-fetched busy intervals, this
 * answers "which slots are actually free?" / "does this specific request
 * conflict?" / "what exact UTC window does this booking need?".
 *
 * This mirrors the Phase 1 pattern in GeminiAIProvider.js
 * (parseModelResponse extracted as a pure function so the real behavior
 * is unit-testable without mocking the SDK): GoogleCalendarAppointmentProvider.js
 * is a thin wrapper that fetches real data and real side effects around
 * these functions; everything that actually decides an outcome lives here
 * and can be tested with plain objects.
 */

const availabilityService = require('../availabilityService');
const { getMinutesSinceMidnightInTimezone, todayInTimezone, zonedWallTimeToUtc } = require('../../utils/timezone');

/** The service's configured duration, or a fallback (the practice's default slot length). */
function getServiceDuration(practice, serviceId, fallbackMinutes) {
  const svc = (practice.services || []).find((s) => s.id === serviceId);
  if (svc && typeof svc.duration === 'number' && svc.duration > 0) return svc.duration;
  return fallbackMinutes || practice.hours.slotMinutes;
}

/** Do two [start,end) UTC-instant intervals overlap? */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Is [startUtc, endUtc) free of every interval in busyIntervals?
 * `ignoreIntervals` lets a reschedule check exclude the appointment's OWN
 * current calendar block (otherwise an appointment always "conflicts"
 * with itself when checking whether it can move to a nearby time).
 */
function isSlotFree(startUtc, endUtc, busyIntervals = [], ignoreIntervals = []) {
  const isIgnored = (busy) =>
    ignoreIntervals.some(
      (ig) => ig.start.getTime() === busy.start.getTime() && ig.end.getTime() === busy.end.getTime()
    );
  return !busyIntervals.some((busy) => !isIgnored(busy) && intervalsOverlap(startUtc, endUtc, busy.start, busy.end));
}

/** The exact UTC [start,end) window a booking of `durationMinutes` starting at `timeLabel` on `dateStr` needs. */
function computeSlotWindowUtc(practice, dateStr, timeLabel, durationMinutes) {
  const startMinutes = availabilityService.labelToMinutes(timeLabel);
  if (startMinutes === null) return null;
  const startUtc = zonedWallTimeToUtc(dateStr, availabilityService.minutesToHHMM(startMinutes), practice.timezone);
  const endUtc = new Date(startUtc.getTime() + durationMinutes * 60000);
  return { startUtc, endUtc };
}

/**
 * Is a booking of `durationMinutes` starting at `timeLabel` on `dateStr`
 * fully inside the practice's open hours for that day (and on a day the
 * practice is even open)? A slot that starts before closing but would
 * RUN PAST closing (e.g. a 90-minute root canal at the last 30-minute
 * slot of the day) is out of bounds — this only mattered once bookings
 * became duration-aware in Phase 2; the mock provider's fixed-length grid
 * never had to consider it.
 */
function isWithinBusinessHours(practice, dateStr, timeLabel, durationMinutes) {
  if (!availabilityService.isOpenDay(practice, dateStr)) return false;
  const window = computeSlotWindowUtc(practice, dateStr, timeLabel, durationMinutes);
  if (!window) return false;
  const dayStart = zonedWallTimeToUtc(dateStr, practice.hours.openTime, practice.timezone);
  const dayEnd = zonedWallTimeToUtc(dateStr, practice.hours.closeTime, practice.timezone);
  return window.startUtc.getTime() >= dayStart.getTime() && window.endUtc.getTime() <= dayEnd.getTime();
}

/**
 * The list of real, bookable slots for `dateStr`, given the real busy
 * intervals already fetched from Google Calendar's freebusy API. Excludes
 * closed days, past times (evaluated in the practice's own timezone —
 * never the server's), slots that would run past closing given
 * `durationMinutes`, and anything overlapping a real busy interval.
 */
function computeAvailableSlots(practice, dateStr, busyIntervals, { durationMinutes } = {}) {
  if (!availabilityService.isOpenDay(practice, dateStr)) return [];

  const duration = durationMinutes || practice.hours.slotMinutes;
  const timezone = practice.timezone;
  const isToday = dateStr === todayInTimezone(timezone);
  const nowMinutes = getMinutesSinceMidnightInTimezone(new Date(), timezone);
  const dayEndUtc = zonedWallTimeToUtc(dateStr, practice.hours.closeTime, timezone);

  const allMinutes = availabilityService.allDaySlotMinutes(practice);
  const results = [];

  for (const startMin of allMinutes) {
    if (isToday && startMin <= nowMinutes + 30) continue;

    const label = availabilityService.minutesToLabel(startMin);
    const window = computeSlotWindowUtc(practice, dateStr, label, duration);
    if (!window) continue;
    if (window.endUtc.getTime() > dayEndUtc.getTime()) continue; // would run past closing
    if (!isSlotFree(window.startUtc, window.endUtc, busyIntervals)) continue;

    results.push({ time: label, minutes: startMin });
  }

  return results;
}

module.exports = {
  getServiceDuration,
  intervalsOverlap,
  isSlotFree,
  computeSlotWindowUtc,
  isWithinBusinessHours,
  computeAvailableSlots,
};
