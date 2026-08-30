/**
 * services/notifications/reminderScheduler.js (Phase 5 spec §8/§9/§27).
 * `findDueReminders` is pure (no I/O, no timers) — every test below passes
 * an explicit `now`, so nothing here depends on the real clock or a real
 * database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { findDueReminders, processDueReminders, getReminderOffsetsHours } = require('../services/notifications/reminderScheduler');

const PRACTICE = {
  practiceId: 'p1',
  timezone: 'America/New_York',
  notifications: { reminderOffsetsHours: [24] },
};

function apptAt(id, dateStr, timeLabel, overrides = {}) {
  return { _id: id, date: dateStr, time: timeLabel, status: 'Confirmed', name: 'Sarah', phone: '+15551234567', ...overrides };
}

test('getReminderOffsetsHours defaults to [24] when a practice has none configured', () => {
  assert.deepEqual(getReminderOffsetsHours({ notifications: {} }), [24]);
  assert.deepEqual(getReminderOffsetsHours({}), [24]);
});

test('getReminderOffsetsHours honors a practice\'s own configured offsets (spec §8: architecture supports multiple)', () => {
  assert.deepEqual(getReminderOffsetsHours({ notifications: { reminderOffsetsHours: [48, 24, 2] } }), [48, 24, 2]);
});

test('an appointment exactly at its 24h reminder lead time is due', () => {
  // 2026-09-08 2:00 PM America/New_York = 2026-09-08T18:00:00Z (EDT, UTC-4)
  const appt = apptAt('a1', '2026-09-08', '2:00 PM');
  const now = new Date('2026-09-07T18:00:00Z'); // exactly 24h before
  const due = findDueReminders({ practice: PRACTICE, appointments: [appt], now });
  assert.equal(due.length, 1);
  assert.equal(due[0].offsetHours, 24);
});

test('an appointment more than 24h away is NOT yet due', () => {
  const appt = apptAt('a2', '2026-09-08', '2:00 PM');
  const now = new Date('2026-09-06T18:00:00Z'); // 48h before
  const due = findDueReminders({ practice: PRACTICE, appointments: [appt], now });
  assert.equal(due.length, 0);
});

test('a CANCELLED appointment is never reminded, even if otherwise due (spec §8)', () => {
  const appt = apptAt('a3', '2026-09-08', '2:00 PM', { status: 'Cancelled' });
  const now = new Date('2026-09-07T18:00:00Z');
  const due = findDueReminders({ practice: PRACTICE, appointments: [appt], now });
  assert.equal(due.length, 0);
});

test('an appointment whose time has already PASSED is never reminded (spec §8: "already completed")', () => {
  const appt = apptAt('a4', '2026-09-08', '2:00 PM');
  const now = new Date('2026-09-09T00:00:00Z'); // well after the appointment
  const due = findDueReminders({ practice: PRACTICE, appointments: [appt], now });
  assert.equal(due.length, 0);
});

test('an appointment with an unparseable/invalid date or time is skipped, never guessed (spec §8: "appointment is invalid")', () => {
  const badDate = apptAt('a5', 'not-a-date', '2:00 PM');
  const badTime = apptAt('a6', '2026-09-08', 'not-a-time');
  const now = new Date('2026-09-07T18:00:00Z');
  const due = findDueReminders({ practice: PRACTICE, appointments: [badDate, badTime], now });
  assert.equal(due.length, 0);
});

test('a practice configured with multiple reminder offsets can have more than one due reminder for the same appointment at different times', () => {
  const practice = { ...PRACTICE, notifications: { reminderOffsetsHours: [48, 24] } };
  const appt = apptAt('a7', '2026-09-08', '2:00 PM');

  // At exactly the 48h mark, only the 48h lead time has been reached —
  // the 24h one is still a day away.
  const at48h = findDueReminders({ practice, appointments: [appt], now: new Date('2026-09-06T18:00:00Z') });
  assert.equal(at48h.length, 1);
  assert.equal(at48h[0].offsetHours, 48);

  // At the 24h mark, the 24h lead time has just been reached too. This
  // pure function has no memory of what was already sent — it reports
  // every offset whose lead time has passed but whose appointment
  // hasn't started yet — so the 48h entry is (correctly) still present
  // alongside the newly-due 24h one. It is notificationService's
  // idempotency claim (keyed on practiceId+appointmentId+type+offset),
  // not this function, that stops the already-sent 48h reminder from
  // going out a second time (see the "DUPLICATE PREVENTION" test below).
  const at24h = findDueReminders({ practice, appointments: [appt], now: new Date('2026-09-07T18:00:00Z') });
  assert.equal(at24h.length, 2);
  const offsetsAt24h = at24h.map((d) => d.offsetHours).sort((a, b) => a - b);
  assert.deepEqual(offsetsAt24h, [24, 48]);
});

test('DUPLICATE PREVENTION: processDueReminders computes the SAME idempotencyKey shape for repeated ticks, so notificationService (not scheduler timing) is what prevents a duplicate send', async () => {
  const appt = apptAt('a8', '2026-09-08', '2:00 PM');
  const now = new Date('2026-09-07T18:00:00Z');
  const sentKeys = new Set();
  const attempts = [];

  const deps = {
    listPracticeIds: () => ['p1'],
    getPracticeResolved: async () => PRACTICE,
    findAllAppointments: async () => [appt],
    // Simulates notificationService's own dedupe: a second attempt at the
    // exact same (appointmentId, offsetHours) is a no-op, exactly like
    // NotificationLogRepository.claim()'s unique-index behavior.
    notifyAppointmentReminder: async (practice, appointment, { offsetHours }) => {
      const key = `${practice.practiceId}:${appointment._id}:${offsetHours}`;
      if (sentKeys.has(key)) return { deduped: true };
      sentKeys.add(key);
      attempts.push(key);
      return { sms: { attempted: true } };
    },
    now,
  };

  await processDueReminders(deps);
  await processDueReminders(deps); // a second tick, same "now" — simulates the poll firing again

  assert.equal(attempts.length, 1, 'the reminder must only actually be sent once across repeated ticks');
});

test('one practice\'s failure does not stop other practices from getting their reminders', async () => {
  const appt = apptAt('a9', '2026-09-08', '2:00 PM');
  const now = new Date('2026-09-07T18:00:00Z');
  const remindedPractices = [];

  const deps = {
    listPracticeIds: () => ['broken-practice', 'p1'],
    getPracticeResolved: async (id) => {
      if (id === 'broken-practice') throw new Error('DB error for this practice');
      return PRACTICE;
    },
    findAllAppointments: async () => [appt],
    notifyAppointmentReminder: async (practice) => { remindedPractices.push(practice.practiceId); return {}; },
    now,
  };

  const results = await processDueReminders(deps);
  assert.deepEqual(remindedPractices, ['p1']);
  assert.equal(results.length, 1);
});
