/**
 * Reminder scheduler / job system (Phase 5 spec §8/§9).
 *
 * Honest architectural note (spec §9: "If the current deployment
 * architecture does not support a persistent job queue, implement a clean
 * provider/service abstraction and document the production scheduler
 * requirement rather than pretending the scheduler is production-grade"):
 * this deployment is a single Node process with no Redis/queue
 * infrastructure (see the Phase 4 report's own notes on the voice
 * scheduler's limits). This module is a polling loop, NOT a real
 * persistent job queue — but it is still SAFE against the specific
 * failure modes the spec calls out, because the thing that actually
 * prevents a duplicate send is not the poll loop's timing, it's
 * repositories/NotificationLogRepository.js#claim()'s atomic, unique-index
 * insert in the database:
 *   - Server restart: due reminders are recomputed fresh from Appointment
 *     documents every tick, and the idempotency key (practiceId +
 *     appointmentId + type + channel + offset) is identical before and
 *     after a restart, so a reminder that already succeeded is never
 *     reattempted, and one that was interrupted mid-send is retried safely.
 *   - Multiple instances: if two instances of this process ever ran at
 *     once, both would compute the same "due" list and both would call
 *     notificationService, but the DATABASE's unique index on
 *     idempotencyKey — not anything in-memory — guarantees only one of
 *     them actually claims and sends any given reminder; the other's
 *     claim() call fails with a duplicate-key error and it correctly skips.
 *   - Race conditions within one instance: the same claim() mechanism
 *     applies even if this module's own interval somehow overlapped itself.
 * For a real multi-instance production deployment at scale, the
 * recommended upgrade is a real persistent job queue (e.g. BullMQ backed
 * by Redis, or a cron-triggered serverless function) calling the exact
 * same processDueReminders()/notificationService functions below — this
 * module's pure logic does not need to change, only what calls it on a
 * schedule.
 */

const practiceRepository = require('../../config/practiceRepository');
const appointmentRepository = require('../../repositories/AppointmentRepository');
const notificationService = require('./notificationService');
const { labelToMinutes, minutesToHHMM } = require('../availabilityService');
const { zonedWallTimeToUtc } = require('../../utils/timezone');

const DEFAULT_REMINDER_OFFSETS_HOURS = [24];
const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;

/** The practice's configured reminder lead times — architecture allows more than one (spec §8: "48 hours, 24 hours, 2 hours"), defaulting to 24h if a practice hasn't configured any. Never hard-coded elsewhere in the codebase — this is the one place that default lives. */
function getReminderOffsetsHours(practice) {
  const configured = practice?.notifications?.reminderOffsetsHours;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured.filter((h) => Number.isFinite(h) && h > 0);
  }
  return DEFAULT_REMINDER_OFFSETS_HOURS;
}

/** The exact UTC instant an appointment's local date+time ('YYYY-MM-DD' + '10:30 AM') represents, in the practice's own timezone — reuses the same conversion Phase 2's calendar integration relies on (utils/timezone.js) rather than a second date-math implementation. Returns null for an unparseable/invalid appointment (spec §8: "must not be sent if ... appointment is invalid") rather than guessing. */
function computeAppointmentDateTimeUtc(practice, appointment) {
  if (!appointment.date || !appointment.time) return null;
  const minutes = labelToMinutes(appointment.time);
  if (minutes === null) return null;
  try {
    return zonedWallTimeToUtc(appointment.date, minutesToHHMM(minutes), practice.timezone);
  } catch (err) {
    return null;
  }
}

/**
 * Pure logic (no I/O) — given a practice, its full appointment list, and
 * "now", returns every (appointment, offsetHours) pair that is currently
 * due for a reminder. Fully unit-testable without a database or clock
 * mocking library (pass any `now`).
 */
function findDueReminders({ practice, appointments, now }) {
  const offsets = getReminderOffsetsHours(practice);
  const due = [];

  for (const appointment of appointments) {
    // Spec §8: never remind a cancelled appointment.
    if (appointment.status === 'Cancelled') continue;

    const apptDateTimeUtc = computeAppointmentDateTimeUtc(practice, appointment);
    if (!apptDateTimeUtc) continue; // invalid — skip rather than guess

    // Spec §8: never remind an appointment that has already happened
    // ("already completed" — this demo app has no separate "completed"
    // status, so "appointment time is in the past" is the honest signal).
    if (apptDateTimeUtc.getTime() <= now.getTime()) continue;

    for (const offsetHours of offsets) {
      const scheduledFor = new Date(apptDateTimeUtc.getTime() - offsetHours * 60 * 60 * 1000);
      // Due once "now" has reached the scheduled lead time, but only up
      // until the appointment itself starts (a reminder computed far in
      // the past — e.g. the scheduler was down for days — should still
      // fire once, not be silently skipped as "missed forever", as long
      // as the appointment itself hasn't happened yet).
      if (now.getTime() >= scheduledFor.getTime() && now.getTime() < apptDateTimeUtc.getTime()) {
        due.push({ appointment, offsetHours, scheduledFor });
      }
    }
  }
  return due;
}

/** One polling tick, for ALL practices — the only place this module does real I/O. Never throws (a single practice's failure must not stop the others); every send goes through notificationService, which is itself dedupe-safe (see file header). */
async function processDueReminders(deps = {}) {
  const getPracticeResolved = deps.getPracticeResolved || practiceRepository.getPracticeResolved;
  const listPracticeIds = deps.listPracticeIds || practiceRepository.listPracticeIds;
  const findAllAppointments = deps.findAllAppointments || appointmentRepository.findAll;
  const notifyReminder = deps.notifyAppointmentReminder || notificationService.notifyAppointmentReminder;
  const now = deps.now || new Date();

  const results = [];
  for (const practiceId of listPracticeIds()) {
    try {
      const practice = await getPracticeResolved(practiceId);
      if (!practice) continue;
      const appointments = await findAllAppointments(practiceId);
      const due = findDueReminders({ practice, appointments, now });
      for (const { appointment, offsetHours } of due) {
        const outcome = await notifyReminder(practice, appointment, { offsetHours, language: appointment.language || 'en' });
        results.push({ practiceId, appointmentId: String(appointment._id), offsetHours, outcome });
      }
    } catch (err) {
      console.error(`reminderScheduler: practice "${practiceId}" tick failed (non-fatal, other practices unaffected):`, err.message);
    }
  }
  return results;
}

let intervalHandle = null;

/** Starts the polling loop. Idempotent — calling twice does not create a second interval. Never called by the test suite (see server.js), so tests never have a background timer running against a real/fake database. */
function startReminderScheduler({ intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  if (intervalHandle) return intervalHandle;
  intervalHandle = setInterval(() => {
    processDueReminders().catch((err) => console.error('reminderScheduler: tick failed unexpectedly (non-fatal):', err.message));
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref(); // never keeps the process alive on its own
  return intervalHandle;
}

function stopReminderScheduler() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  findDueReminders,
  processDueReminders,
  computeAppointmentDateTimeUtc,
  getReminderOffsetsHours,
  startReminderScheduler,
  stopReminderScheduler,
  DEFAULT_REMINDER_OFFSETS_HOURS,
};
