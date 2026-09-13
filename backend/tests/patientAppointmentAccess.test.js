/**
 * Patient-facing appointment API: who is allowed to see and change what.
 *
 * These are regression tests for real, confirmed holes found in the
 * Sept 2026 audit, not restatements of the implementation. Each one
 * describes an attack that worked against the code as shipped through
 * Phase 6, so each one fails if the fix is ever reverted:
 *
 *   - listing every patient in the practice from an unauthenticated route
 *   - reading a patient's appointment knowing only their phone number
 *   - cancelling someone else's appointment knowing only its id
 *
 * The router is built with an injected tools layer, so what is under test
 * is the route's own authorization decision — not the database.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { buildAppointmentsRouter } = require('../routes/appointments');
const patientAccessLimiter = require('../services/appointments/patientAccessLimiter');

const PRACTICE = {
  practiceId: 'practice-a',
  name: 'Practice A Dental',
  phone: '+1-555-0100',
  address: '1 Main St',
  demoMode: true,
};

const ALICE = {
  _id: 'appt-alice',
  name: 'Alice Patient',
  phone: '+1-555-1111',
  email: 'alice@example.com',
  service: 'Cleaning',
  date: '2026-10-01',
  time: '10:00 AM',
  status: 'Confirmed',
  bookingReference: 'K7QF2M9XBT',
};

/**
 * A tools double backed by one appointment, applying the same access rule
 * the real tools layer applies: the reference must match.
 */
function fakeTools(overrides = {}) {
  return {
    create_appointment: async (practice, data) => ({ ...data, _id: 'appt-new', bookingReference: 'NEWREF1234', status: 'Confirmed' }),
    lookup_appointment_for_patient: async (practice, phone, reference) =>
      phone === ALICE.phone && reference === ALICE.bookingReference ? ALICE : null,
    verify_patient_appointment_access: async (practice, id, reference) =>
      id === ALICE._id && reference === ALICE.bookingReference ? ALICE : null,
    reschedule_appointment: async (practice, id, patch) => ({ ...ALICE, ...patch, status: 'Rescheduled' }),
    cancel_appointment: async () => ({ ...ALICE, status: 'Cancelled' }),
    ...overrides,
  };
}

function buildRouter(overrides) {
  return buildAppointmentsRouter({ tools: fakeTools(overrides) });
}

function req(extra = {}) {
  return { practice: PRACTICE, practiceId: PRACTICE.practiceId, body: {}, params: {}, query: {}, headers: {}, ...extra };
}

beforeEach(() => patientAccessLimiter.reset());

test('EXPOSURE: there is no unauthenticated route that lists the practice\'s appointments', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(router, 'GET', '/appointments', req());
  // No matching route: the harness exhausts the stack without a response.
  assert.equal(res.body, undefined, 'GET /appointments must not return data to an unauthenticated caller');
});

test('EXPOSURE: the phone-only search route no longer exists', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(router, 'GET', '/appointments/search', req({ query: { phone: ALICE.phone } }));
  assert.equal(res.body, undefined, 'a phone number alone must not return appointments');
});

test('LOOKUP: a correct phone with no booking reference is refused', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(router, 'POST', '/appointments/lookup', req({ body: { phone: ALICE.phone } }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.data, undefined);
});

test('LOOKUP: a correct phone with the wrong reference reveals nothing', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(
    router,
    'POST',
    '/appointments/lookup',
    req({ body: { phone: ALICE.phone, reference: 'WRONGREF99' } })
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data, undefined);
  assert.ok(!JSON.stringify(res.body).includes('Alice'), 'a failed lookup must not leak patient details');
});

test('LOOKUP: a wrong reference is indistinguishable from an unknown phone number', async () => {
  const router = buildRouter();
  const wrongRef = await invokeRoute(router, 'POST', '/appointments/lookup', req({ body: { phone: ALICE.phone, reference: 'WRONGREF99' } }));
  const unknownPhone = await invokeRoute(router, 'POST', '/appointments/lookup', req({ body: { phone: '+1-555-9999', reference: 'WRONGREF99' } }));

  assert.equal(wrongRef.res.statusCode, unknownPhone.res.statusCode);
  assert.deepEqual(wrongRef.res.body, unknownPhone.res.body, 'responses must not let an attacker confirm a phone number is a patient here');
});

test('LOOKUP: phone plus the correct reference returns that patient\'s own appointment', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(
    router,
    'POST',
    '/appointments/lookup',
    req({ body: { phone: ALICE.phone, reference: ALICE.bookingReference } })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.name, 'Alice Patient');
  assert.equal(res.body.data.date, '2026-10-01');
});

test('LOOKUP: repeated wrong references lock the phone number out before a reference can be guessed', async () => {
  const router = buildRouter();
  for (let i = 0; i < patientAccessLimiter.MAX_ATTEMPTS; i += 1) {
    await invokeRoute(router, 'POST', '/appointments/lookup', req({ body: { phone: ALICE.phone, reference: 'WRONGREF99' } }));
  }

  // Even the CORRECT reference is refused once locked out — the lockout is
  // on the phone number, not on the guess.
  const { res } = await invokeRoute(
    router,
    'POST',
    '/appointments/lookup',
    req({ body: { phone: ALICE.phone, reference: ALICE.bookingReference } })
  );
  assert.equal(res.statusCode, 429);
  assert.ok(res.body.retryAfterSeconds > 0);
});

test('CANCEL: knowing an appointment id is not enough to cancel it', async () => {
  let cancelCalled = false;
  const router = buildRouter({ cancel_appointment: async () => { cancelCalled = true; return { ...ALICE, status: 'Cancelled' }; } });

  const { res } = await invokeRoute(router, 'DELETE', '/appointments/:id', req({ params: { id: ALICE._id } }));

  assert.equal(res.statusCode, 400);
  assert.equal(cancelCalled, false, 'the cancellation must never reach the tools layer without proof of ownership');
});

test('CANCEL: a wrong booking reference cannot cancel someone else\'s appointment', async () => {
  let cancelCalled = false;
  const router = buildRouter({ cancel_appointment: async () => { cancelCalled = true; return { ...ALICE, status: 'Cancelled' }; } });

  const { res } = await invokeRoute(
    router,
    'DELETE',
    '/appointments/:id',
    req({ params: { id: ALICE._id }, body: { reference: 'WRONGREF99' } })
  );

  assert.equal(res.statusCode, 404);
  assert.equal(cancelCalled, false);
});

test('CANCEL: the patient who holds the reference can still cancel their own appointment', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(
    router,
    'DELETE',
    '/appointments/:id',
    req({ params: { id: ALICE._id }, body: { reference: ALICE.bookingReference } })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.status, 'Cancelled');
});

test('RESCHEDULE: a wrong booking reference cannot move someone else\'s appointment', async () => {
  let rescheduleCalled = false;
  const router = buildRouter({ reschedule_appointment: async () => { rescheduleCalled = true; return ALICE; } });

  const { res } = await invokeRoute(
    router,
    'PATCH',
    '/appointments/:id',
    req({ params: { id: ALICE._id }, body: { date: '2026-10-02', reference: 'WRONGREF99' } })
  );

  assert.equal(res.statusCode, 404);
  assert.equal(rescheduleCalled, false);
});

test('RESCHEDULE: the reference holder can move their own appointment', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(
    router,
    'PATCH',
    '/appointments/:id',
    req({ params: { id: ALICE._id }, body: { date: '2026-10-02', time: '2:00 PM', reference: ALICE.bookingReference } })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.date, '2026-10-02');
  assert.equal(res.body.data.status, 'Rescheduled');
});

test('BOOKING: the reference is returned to the patient, since it is the only time they see it', async () => {
  const router = buildRouter();
  const { res } = await invokeRoute(
    router,
    'POST',
    '/appointments',
    req({ body: { name: 'Bob', phone: '+1-555-2222', service: 'Cleaning', date: '2026-10-05', time: '9:00 AM' } })
  );
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.bookingReference, 'a booking with no reference leaves the patient unable to manage it');
});

test('BOOKING: the response never carries fields the patient has no business seeing', async () => {
  const router = buildRouter({
    create_appointment: async () => ({
      _id: 'appt-new',
      name: 'Bob',
      phone: '+1-555-2222',
      date: '2026-10-05',
      status: 'Confirmed',
      bookingReference: 'NEWREF1234',
      // Internal fields that must not be published.
      pmsPatientId: 'PMS-88',
      calendarEventId: 'evt-internal-1',
    }),
  });

  const { res } = await invokeRoute(
    router,
    'POST',
    '/appointments',
    req({ body: { name: 'Bob', phone: '+1-555-2222', service: 'Cleaning', date: '2026-10-05' } })
  );

  assert.equal(res.body.data.pmsPatientId, undefined);
  assert.equal(res.body.data.calendarEventId, undefined);
});
