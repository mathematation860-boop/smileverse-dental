/**
 * The tools-layer access rules behind the patient endpoints, including
 * the cross-tenant question the booking reference introduces: a reference
 * is a bearer secret, so it must be worthless at any practice other than
 * the one that issued it.
 *
 * These exercise the real tools functions against a repository double
 * that scopes by practiceId exactly as AppointmentRepository does — the
 * scoping IS the thing under test, so faking it away would test nothing.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const tools = require('../tools/receptionistTools');
const appointmentRepository = require('../repositories/AppointmentRepository');
const {
  generateBookingReference,
  normalizeBookingReference,
  referenceMatches,
  BOOKING_REFERENCE_LENGTH,
} = require('../services/appointments/bookingReference');

const PRACTICE_A = { practiceId: 'practice-a', name: 'Practice A' };
const PRACTICE_B = { practiceId: 'practice-b', name: 'Practice B' };

const ROWS = [
  {
    _id: 'a1',
    practiceId: 'practice-a',
    name: 'Alice',
    phone: '+1-555-1111',
    date: '2026-10-01',
    time: '10:00 AM',
    status: 'Confirmed',
    bookingReference: 'K7QF2M9XBT',
  },
  {
    // Booked before references existed — nothing to prove ownership with.
    _id: 'a2',
    practiceId: 'practice-a',
    name: 'Legacy Patient',
    phone: '+1-555-3333',
    date: '2026-10-02',
    time: '11:00 AM',
    status: 'Confirmed',
    bookingReference: null,
  },
];

/** Stands in for AppointmentRepository, scoping every read by practiceId. */
function withFakeRepo(run) {
  const original = {
    findById: appointmentRepository.findById,
    findByPhoneAndReference: appointmentRepository.findByPhoneAndReference,
  };
  appointmentRepository.findById = async (practiceId, id) =>
    ROWS.find((r) => r.practiceId === practiceId && r._id === id) || null;
  appointmentRepository.findByPhoneAndReference = async (practiceId, phone, reference) =>
    ROWS.find((r) => r.practiceId === practiceId && r.phone === phone && r.bookingReference === reference) || null;

  return Promise.resolve(run()).finally(() => Object.assign(appointmentRepository, original));
}

test('CROSS-TENANT: a reference issued by practice A is worthless at practice B', async () => {
  await withFakeRepo(async () => {
    const atOwnPractice = await tools.lookup_appointment_for_patient(PRACTICE_A, '+1-555-1111', 'K7QF2M9XBT');
    const atOtherPractice = await tools.lookup_appointment_for_patient(PRACTICE_B, '+1-555-1111', 'K7QF2M9XBT');

    assert.equal(atOwnPractice.name, 'Alice');
    assert.equal(atOtherPractice, null);
  });
});

test('CROSS-TENANT: practice B cannot reach practice A\'s appointment by id and reference', async () => {
  await withFakeRepo(async () => {
    assert.ok(await tools.verify_patient_appointment_access(PRACTICE_A, 'a1', 'K7QF2M9XBT'));
    assert.equal(await tools.verify_patient_appointment_access(PRACTICE_B, 'a1', 'K7QF2M9XBT'), null);
  });
});

test('LEGACY RECORDS: an appointment with no reference cannot be changed through the public API', async () => {
  await withFakeRepo(async () => {
    // Not an oversight — there is no secret to check against, so the only
    // safe answer is "call the front desk".
    assert.equal(await tools.verify_patient_appointment_access(PRACTICE_A, 'a2', 'K7QF2M9XBT'), null);
    assert.equal(await tools.verify_patient_appointment_access(PRACTICE_A, 'a2', ''), null);
  });
});

test('references are unguessable and unique across many issues', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(generateBookingReference());
  assert.equal(seen.size, 2000, 'a repeat inside 2000 draws would mean far too little entropy');
});

test('references avoid characters people confuse when reading one out', () => {
  const joined = Array.from({ length: 300 }, () => generateBookingReference()).join('');
  for (const confusable of ['0', '1', 'I', 'L', 'O', 'U']) {
    assert.ok(!joined.includes(confusable), `references must never contain "${confusable}"`);
  }
});

test('a reference typed back with dashes, spaces or lowercase still matches', () => {
  assert.equal(normalizeBookingReference('k7qf-2m9x-bt'), 'K7QF2M9XBT');
  assert.equal(normalizeBookingReference(' K7QF 2M9X BT '), 'K7QF2M9XBT');
});

test('anything that could not be a reference is rejected before a lookup is spent on it', () => {
  assert.equal(normalizeBookingReference('short'), null);
  assert.equal(normalizeBookingReference('K7QF2M9XB0'), null, 'contains an excluded character');
  assert.equal(normalizeBookingReference(null), null);
  assert.equal(normalizeBookingReference({ toString: () => 'K7QF2M9XBT' }), null, 'non-strings must not be coerced');
  assert.equal(normalizeBookingReference('K7QF2M9XBTEXTRA'), null);
});

test('comparison never treats an empty or missing stored reference as a match', () => {
  assert.equal(referenceMatches('', ''), false);
  assert.equal(referenceMatches('K7QF2M9XBT', ''), false);
  assert.equal(referenceMatches('K7QF2M9XBT', null), false);
  assert.equal(referenceMatches('K7QF2M9XBT', 'K7QF2M9XBT'), true);
});

test('a reference is long enough to be worth rate limiting', () => {
  assert.ok(BOOKING_REFERENCE_LENGTH >= 8);
});
