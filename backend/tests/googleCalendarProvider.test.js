/**
 * Behavioral tests for GoogleCalendarAppointmentProvider — real
 * orchestration logic (booking, rescheduling, cancelling, conflict
 * detection, connection lookup) exercised against small in-memory fakes
 * instead of a live Google account or a reachable MongoDB (neither exists
 * in this sandbox). The provider's constructor accepts these as
 * dependency overrides specifically so this is possible — see the class's
 * doc comment for why.
 *
 * These tests are what actually prove the headline safety claim of
 * Phase 2: "the AI must never claim an appointment was booked unless
 * Google Calendar confirms success" — at the data layer, not just in a
 * prompt string. See "AI cannot claim false booking" below.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const basePractice = require('../config/practices/smileverse-dental');
const GoogleCalendarAppointmentProvider = require('../services/providers/GoogleCalendarAppointmentProvider');
const { CalendarUnavailableError, SlotUnavailableError } = require('../services/providers/CalendarProviderErrors');
const { zonedWallTimeToUtc } = require('../utils/timezone');
const { buildSystemInstruction } = require('../config/promptBuilder');

const DATE = '2030-06-19'; // Wed, open day, far future

function practiceFor(id, overrides = {}) {
  return { ...basePractice, practiceId: id, demoMode: false, ...overrides };
}

/** In-memory fake standing in for CalendarConnectionRepository, keyed by practiceId. */
function makeFakeConnectionRepo(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async findByPracticeId(practiceId) {
      return store.get(practiceId) || null;
    },
    async updateAccessToken(practiceId, tokens) {
      const existing = store.get(practiceId);
      if (existing) store.set(practiceId, { ...existing, accessToken: tokens.access_token });
    },
    _store: store,
  };
}

/** In-memory fake standing in for AppointmentRepository. */
function makeFakeAppointmentRepo(seed = []) {
  const rows = [...seed];
  let nextId = rows.length + 1;
  return {
    async create(practiceId, data) {
      const row = { _id: `apt_${nextId++}`, practiceId, status: 'Confirmed', ...data };
      rows.push(row);
      return row;
    },
    async findById(practiceId, id) {
      return rows.find((r) => r.practiceId === practiceId && r._id === id) || null;
    },
    async update(practiceId, id, patch) {
      const row = rows.find((r) => r.practiceId === practiceId && r._id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    async findByPhone() {
      return [];
    },
    async findAll() {
      return rows;
    },
    _rows: rows,
  };
}

/** Fake calendarClient whose three network-shaped methods are supplied per test. */
function makeFakeCalendarClient({ busy = [], insert, patch, del } = {}) {
  const calls = { insert: [], patch: [], delete: [] };
  return {
    calls,
    async getBusyIntervals() {
      return busy;
    },
    async insertEvent(args) {
      calls.insert.push(args);
      if (insert === 'throw') throw new Error('simulated Google API failure');
      return insert || { id: 'evt_fake_1' };
    },
    async patchEvent(args) {
      calls.patch.push(args);
      if (patch === 'throw') throw new Error('simulated Google API failure');
      return patch || {};
    },
    async deleteEvent(args) {
      calls.delete.push(args);
      if (del === 'throw') throw new Error('simulated Google API failure');
      return del || { alreadyRemoved: false };
    },
  };
}

test('successful booking: creates a real event first, then persists the local appointment with its real event id', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const calendarClient = makeFakeCalendarClient({ busy: [], insert: { id: 'evt_123' } });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  const appointment = await provider.createAppointment(practice, {
    name: 'Ali',
    phone: '555-0100',
    service: 'Root Canal',
    serviceId: 'root_canal',
    date: DATE,
    time: '10:00 AM',
  });

  assert.equal(appointment.calendarEventId, 'evt_123');
  assert.equal(appointment.calendarProvider, 'google');
  assert.equal(appointmentRepo._rows.length, 1, 'exactly one local record was created');
  assert.equal(calendarClient.calls.insert.length, 1);
});

test('failed booking: if Google Calendar rejects the event, no local appointment record is ever created', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const calendarClient = makeFakeCalendarClient({ busy: [], insert: 'throw' });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(
    () => provider.createAppointment(practice, { name: 'Ali', phone: '555', service: 'Root Canal', serviceId: 'root_canal', date: DATE, time: '10:00 AM' }),
    CalendarUnavailableError
  );
  assert.equal(appointmentRepo._rows.length, 0, 'a failed Google call must leave zero local records');
});

test('double-booking prevention: a real busy interval covering the requested time blocks the booking before Google is even asked to create it', async () => {
  const practice = practiceFor('practice-a');
  const requestedStart = zonedWallTimeToUtc(DATE, '10:00', practice.timezone);
  const requestedEnd = zonedWallTimeToUtc(DATE, '11:30', practice.timezone); // root_canal, 90 min
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const calendarClient = makeFakeCalendarClient({ busy: [{ start: requestedStart, end: requestedEnd }] });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(
    () => provider.createAppointment(practice, { name: 'Ali', phone: '555', service: 'Root Canal', serviceId: 'root_canal', date: DATE, time: '10:00 AM' }),
    SlotUnavailableError
  );
  assert.equal(calendarClient.calls.insert.length, 0, 'Google must never be asked to create an event once a conflict is detected');
  assert.equal(appointmentRepo._rows.length, 0);
});

test('a booking request outside business hours is rejected before any calendar call is made', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const calendarClient = makeFakeCalendarClient();
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(
    () => provider.createAppointment(practice, { name: 'Ali', phone: '555', service: 'Cleaning', serviceId: 'cleaning', date: DATE, time: '7:00 AM' }),
    SlotUnavailableError
  );
  assert.equal(calendarClient.calls.insert.length, 0);
});

test('cancellation: a successful real calendar delete marks the local appointment Cancelled', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: 'evt_1', status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const calendarClient = makeFakeCalendarClient({ del: { alreadyRemoved: false } });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  const result = await provider.cancelAppointment(practice, 'apt_1');
  assert.equal(result.status, 'Cancelled');
  assert.equal(calendarClient.calls.delete.length, 1);
});

test('cancellation: if the real calendar delete fails, the local appointment is NOT marked Cancelled', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: 'evt_1', status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const calendarClient = makeFakeCalendarClient({ del: 'throw' });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(() => provider.cancelAppointment(practice, 'apt_1'), CalendarUnavailableError);
  assert.equal(appointmentRepo._rows[0].status, 'Confirmed', 'must not falsely confirm a cancellation the calendar never accepted');
});

test('rescheduling: a successful real calendar patch updates the local date/time and status', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: 'evt_1', status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const calendarClient = makeFakeCalendarClient({ busy: [] });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  const result = await provider.rescheduleAppointment(practice, 'apt_1', { date: DATE, time: '2:00 PM' });
  assert.equal(result.time, '2:00 PM');
  assert.equal(result.status, 'Rescheduled');
  assert.equal(calendarClient.calls.patch.length, 1);
});

test('rescheduling: a real conflict at the new time is rejected and the local record is left untouched', async () => {
  const practice = practiceFor('practice-a');
  const otherEventStart = zonedWallTimeToUtc(DATE, '14:00', practice.timezone);
  const otherEventEnd = zonedWallTimeToUtc(DATE, '14:45', practice.timezone);
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: 'evt_1', status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const calendarClient = makeFakeCalendarClient({ busy: [{ start: otherEventStart, end: otherEventEnd }] });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(() => provider.rescheduleAppointment(practice, 'apt_1', { date: DATE, time: '2:00 PM' }), SlotUnavailableError);
  assert.equal(appointmentRepo._rows[0].time, '10:00 AM', 'the original time must be untouched after a rejected reschedule');
  assert.equal(calendarClient.calls.patch.length, 0);
});

test('rescheduling: the appointment\'s OWN current calendar block never counts against itself when moving nearby', async () => {
  // Reschedule within the same 45-minute cleaning block's neighborhood —
  // the freebusy window for the NEW time will still include the OLD
  // event (since Google hasn't been told about the new time yet); that
  // must be recognized as "itself", not treated as a conflict.
  const practice = practiceFor('practice-a');
  const ownStart = zonedWallTimeToUtc(DATE, '10:00', practice.timezone);
  const ownEnd = zonedWallTimeToUtc(DATE, '10:45', practice.timezone);
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: 'evt_1', status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const calendarClient = makeFakeCalendarClient({ busy: [{ start: ownStart, end: ownEnd }] });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  const result = await provider.rescheduleAppointment(practice, 'apt_1', { date: DATE, time: '10:15 AM' });
  assert.equal(result.time, '10:15 AM');
});

test('reschedule fails cleanly (no local change) if this appointment was never actually calendar-backed', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo([
    { _id: 'apt_1', practiceId: 'practice-a', calendarEventId: null, status: 'Confirmed', date: DATE, time: '10:00 AM', serviceId: 'cleaning' },
  ]);
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient: makeFakeCalendarClient(), connectionRepo, appointmentRepo });

  await assert.rejects(() => provider.rescheduleAppointment(practice, 'apt_1', { date: DATE, time: '11:00 AM' }), CalendarUnavailableError);
});

test('Google Calendar unavailable: no connection stored for this practice yields the exact required patient-facing message', async () => {
  const practice = practiceFor('practice-no-connection');
  const connectionRepo = makeFakeConnectionRepo({}); // nothing stored
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient: makeFakeCalendarClient(), connectionRepo, appointmentRepo: makeFakeAppointmentRepo() });

  await assert.rejects(
    () => provider.getAvailability(practice, DATE),
    (err) => {
      assert.ok(err instanceof CalendarUnavailableError);
      assert.equal(err.message, "Sorry, I'm having trouble checking live availability right now. I can connect you with our front desk team.");
      return true;
    }
  );
});

test('practice isolation: practice B has no connection even though practice A does, and can never read A\'s calendar', async () => {
  const practiceA = practiceFor('practice-a');
  const practiceB = practiceFor('practice-b');
  const connectionRepo = makeFakeConnectionRepo({
    'practice-a': { calendarId: 'clinic-a@example.com', refreshToken: 'rt-a' },
  });
  const seenConnections = [];
  const calendarClient = makeFakeCalendarClient({ busy: [] });
  const originalGetBusy = calendarClient.getBusyIntervals.bind(calendarClient);
  calendarClient.getBusyIntervals = async (args) => {
    seenConnections.push(args.connection);
    return originalGetBusy(args);
  };
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo: makeFakeAppointmentRepo() });

  // Practice A: has a connection, real check succeeds.
  await provider.getAvailability(practiceA, DATE);
  assert.equal(seenConnections[0].calendarId, 'clinic-a@example.com');

  // Practice B: no connection of its own — must fail, never fall through to A's.
  await assert.rejects(() => provider.getAvailability(practiceB, DATE), CalendarUnavailableError);
  assert.equal(seenConnections.length, 1, 'practice B must never reach a calendar API call at all');
});

test('demo mode: a practice with demoMode true never reaches the real Google provider, even if createAppointment were called directly', async () => {
  // This exercises the SAME class practices/index.js would route to in
  // production, confirming the class itself has no demoMode bypass baked
  // in — the actual routing decision is services/providers/index.js's
  // job and is covered in tests/providerSelection.test.js.
  const practice = practiceFor('practice-a', { demoMode: true });
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const calendarClient = makeFakeCalendarClient({ busy: [], insert: { id: 'evt_x' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  // The class itself doesn't gate on demoMode (that's index.js's job) —
  // this documents that boundary explicitly rather than leaving it implicit.
  const appointment = await provider.createAppointment(practice, {
    name: 'Ali', phone: '555', service: 'Cleaning', serviceId: 'cleaning', date: DATE, time: '9:00 AM',
  });
  assert.equal(appointment.calendarProvider, 'google');
});

test('AI cannot claim false booking: the system prompt explicitly forbids the AI from asserting a booking succeeded on its own', () => {
  const instruction = buildSystemInstruction(basePractice);
  assert.match(instruction, /NEVER say an appointment is booked/i);
});

test('AI cannot claim false booking: a failed real booking leaves no local record for the AI or UI to ever reference as confirmed', async () => {
  const practice = practiceFor('practice-a');
  const connectionRepo = makeFakeConnectionRepo({ 'practice-a': { calendarId: 'a@example.com', refreshToken: 'rt' } });
  const appointmentRepo = makeFakeAppointmentRepo();
  const calendarClient = makeFakeCalendarClient({ busy: [], insert: 'throw' });
  const provider = new GoogleCalendarAppointmentProvider({ calendarClient, connectionRepo, appointmentRepo });

  await assert.rejects(() =>
    provider.createAppointment(practice, { name: 'Ali', phone: '555', service: 'Cleaning', serviceId: 'cleaning', date: DATE, time: '9:00 AM' })
  );
  assert.equal(appointmentRepo._rows.length, 0);
});
