/**
 * What happens when the calendar answers slowly, wrongly, or not at all.
 *
 * MOCK-TESTED, NOT LIVE-VERIFIED. Every calendar here is an injected fake.
 * That is enough to pin down the decisions the provider makes — what it
 * retries, what it rolls back, what it tells the patient — because those
 * decisions are ours. It is NOT evidence that Google behaves as assumed:
 * that a client-supplied event id is accepted, that a duplicate id really
 * returns 409, and that the timeout option really aborts the request are
 * Google's behaviours, and they are listed as requiring a live account.
 *
 * The failure the timeout tests are about: before this, an insert that
 * timed out was reported as a plain failure and no local record was
 * written — but Google may well have created the event, leaving a real
 * appointment blocking a real slot that no one could find or cancel.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const GoogleCalendarAppointmentProvider = require('../services/providers/GoogleCalendarAppointmentProvider');
const {
  CalendarUnavailableError,
  BookingNotRecordedError,
  BookingOutcomeUncertainError,
  ChangeNotRecordedError,
} = require('../services/providers/CalendarProviderErrors');

const PRACTICE = {
  practiceId: 'practice-a',
  name: 'Practice A Dental',
  timezone: 'America/New_York',
  demoMode: false,
  integrations: { calendarProvider: 'google' },
  hours: { openDays: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '17:00', slotMinutes: 30 },
  services: [{ id: 'cleaning', name: 'Cleaning', durationMinutes: 30, price: 150 }],
};

// Synthetic patient, 555 reserved range.
const BOOKING = {
  name: 'Test Patient One',
  phone: '+1-555-0101',
  service: 'Cleaning',
  serviceId: 'cleaning',
  date: '2026-10-01',
  time: '10:00 AM',
};

const connectionRepo = {
  async findByPracticeId() {
    return { calendarId: 'primary', refreshToken: 'r' };
  },
  async updateAccessToken() {},
};

function timeoutError() {
  const err = new Error('request timed out');
  err.code = 'ETIMEDOUT';
  return err;
}

function httpError(status, message = 'error') {
  const err = new Error(message);
  err.code = status;
  return err;
}

/**
 * A calendar whose insert behaves like Google would if the FIRST attempt
 * reached it but the response never came back: the event exists, so the
 * retry with the same client-supplied id is refused with 409.
 */
function calendarThatTimesOutThenSaysDuplicate() {
  const calls = { inserts: [], deletes: [] };
  let attempt = 0;
  return {
    calls,
    async getBusyIntervals() { return []; },
    async insertEvent({ event }) {
      attempt += 1;
      calls.inserts.push(event.id);
      if (attempt === 1) throw timeoutError();
      // Same behaviour the real client maps a 409 into.
      return { id: event.id, alreadyExists: true };
    },
    async patchEvent() { return { id: 'evt' }; },
    async deleteEvent({ eventId }) { calls.deletes.push(eventId); },
  };
}

function memoryRepo() {
  const rows = [];
  return {
    rows,
    async create(practiceId, data) {
      const doc = { _id: `a${rows.length + 1}`, practiceId, ...data };
      rows.push(doc);
      return doc;
    },
    async findById(practiceId, id) { return rows.find((r) => r._id === id) || null; },
    async update(practiceId, id, patch) {
      const row = rows.find((r) => r._id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
  };
}

test('TIMEOUT: an insert that times out is retried with the SAME event id, not a new one', async () => {
  const calendar = calendarThatTimesOutThenSaysDuplicate();
  const repo = memoryRepo();
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient: calendar, connectionRepo, appointmentRepo: repo });

  const appointment = await provider.createAppointment(PRACTICE, BOOKING);

  assert.equal(calendar.calls.inserts.length, 2, 'the ambiguous attempt must be retried');
  assert.equal(calendar.calls.inserts[0], calendar.calls.inserts[1], 'a retry with a NEW id would book the patient twice');
  assert.equal(appointment.calendarEventId, calendar.calls.inserts[0]);
});

test('TIMEOUT: the recovered booking is recorded exactly once and reported as booked', async () => {
  const repo = memoryRepo();
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: calendarThatTimesOutThenSaysDuplicate(),
    connectionRepo,
    appointmentRepo: repo,
  });

  await provider.createAppointment(PRACTICE, BOOKING);
  assert.equal(repo.rows.length, 1, 'one visit, one record');
  assert.equal(repo.rows[0].calendarProvider, 'google');
});

test('TIMEOUT TWICE: a calendar that never answers fails cleanly, with nothing recorded', async () => {
  const repo = memoryRepo();
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async insertEvent() { throw timeoutError(); },
      async deleteEvent() {},
    },
    connectionRepo,
    appointmentRepo: repo,
  });

  const err = await provider.createAppointment(PRACTICE, BOOKING).catch((e) => e);
  assert.ok(err instanceof BookingOutcomeUncertainError, 'the event may exist — this is not a clean failure');
  assert.equal(err.booked, 'unknown');
  assert.match(err.message, /couldn't confirm|call the clinic/i);
  assert.doesNotMatch(err.message, /nothing has been reserved/i, 'never claim nothing happened when we cannot know');
  assert.equal(repo.rows.length, 0, 'nothing may be recorded when the outcome is unknown');
});

test('UNAMBIGUOUS FAILURE: a 403 is not retried — the answer was clear the first time', async () => {
  let attempts = 0;
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async insertEvent() { attempts += 1; throw httpError(403, 'insufficient permissions'); },
      async deleteEvent() {},
    },
    connectionRepo,
    appointmentRepo: memoryRepo(),
  });

  const err = await provider.createAppointment(PRACTICE, BOOKING).catch((e) => e);
  assert.equal(attempts, 1, 'retrying a definite rejection just doubles the load');
  assert.ok(err instanceof CalendarUnavailableError);
  assert.equal(err.reason, 'api_error');
});

test('DATABASE FAILURE AFTER A RECOVERED TIMEOUT: the event is still rolled back', async () => {
  const calendar = calendarThatTimesOutThenSaysDuplicate();
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: calendar,
    connectionRepo,
    appointmentRepo: { async create() { throw new Error('mongo unreachable'); } },
  });

  const err = await provider.createAppointment(PRACTICE, BOOKING).catch((e) => e);
  assert.ok(err instanceof BookingNotRecordedError);
  assert.equal(calendar.calls.deletes.length, 1, 'the recovered event must be cleaned up like any other');
  assert.equal(calendar.calls.deletes[0], calendar.calls.inserts[0]);
});

test('ROLLBACK FAILURE: the patient is still told nothing was reserved', async () => {
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async insertEvent({ event }) { return { id: event.id }; },
      async deleteEvent() { throw new Error('delete failed as well'); },
    },
    connectionRepo,
    appointmentRepo: { async create() { throw new Error('mongo unreachable'); } },
  });

  const err = await provider.createAppointment(PRACTICE, BOOKING).catch((e) => e);
  assert.ok(err instanceof BookingOutcomeUncertainError, 'an event we could not remove means we do not know');
  assert.equal(err.booked, 'unknown');
  assert.doesNotMatch(err.message, /nothing has been reserved/i);
  assert.ok(err.orphanedCalendarEventId, 'the slot now blocked by a phantom event must be traceable');
});

test('PARTIAL RESCHEDULE: the calendar moved but the database did not — say so, do not claim success', async () => {
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async patchEvent() { return { id: 'evt-1' }; },
      async deleteEvent() {},
    },
    connectionRepo,
    appointmentRepo: {
      async findById() {
        return { _id: 'a1', calendarEventId: 'evt-1', serviceId: 'cleaning', date: '2026-10-01', time: '10:00 AM', status: 'Confirmed' };
      },
      async update() { throw new Error('mongo unreachable'); },
    },
  });

  const err = await provider.rescheduleAppointment(PRACTICE, 'a1', { time: '11:00 AM' }).catch((e) => e);
  assert.ok(err instanceof ChangeNotRecordedError);
  assert.equal(err.operation, 'reschedule');
  assert.equal(err.needsReconciliation, true);
  assert.match(err.message, /call the front desk/i);
});

test('PARTIAL CANCEL: an appointment removed from the calendar but not the database is flagged for reconciliation', async () => {
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async deleteEvent() { return { alreadyRemoved: false }; },
    },
    connectionRepo,
    appointmentRepo: {
      async findById() { return { _id: 'a1', calendarEventId: 'evt-1', date: '2026-10-01', time: '10:00 AM', status: 'Confirmed' }; },
      async update() { throw new Error('mongo unreachable'); },
    },
  });

  const err = await provider.cancelAppointment(PRACTICE, 'a1').catch((e) => e);
  assert.ok(err instanceof ChangeNotRecordedError);
  assert.equal(err.operation, 'cancel');
  assert.equal(err.calendarEventId, 'evt-1');
});

test('CANCEL OF AN ALREADY-DELETED EVENT still settles the local record', async () => {
  // Google answering 404 means the outcome the patient asked for is already
  // true, so this must not be treated as a failure.
  const repo = memoryRepo();
  repo.rows.push({ _id: 'a1', practiceId: 'practice-a', calendarEventId: 'evt-1', status: 'Confirmed', date: '2026-10-01', time: '10:00 AM' });

  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { return []; },
      async deleteEvent() { return { alreadyRemoved: true }; },
    },
    connectionRepo,
    appointmentRepo: repo,
  });

  const cancelled = await provider.cancelAppointment(PRACTICE, 'a1');
  assert.equal(cancelled.status, 'Cancelled');
});

test('AVAILABILITY: a calendar that cannot be reached never yields a fabricated free slot', async () => {
  const provider = new GoogleCalendarAppointmentProvider({
    calendarClient: {
      async getBusyIntervals() { throw timeoutError(); },
    },
    connectionRepo,
    appointmentRepo: memoryRepo(),
  });

  await assert.rejects(() => provider.getAvailability(PRACTICE, '2026-10-01'), CalendarUnavailableError);
});
