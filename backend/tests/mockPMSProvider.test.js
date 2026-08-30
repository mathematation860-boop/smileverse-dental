/**
 * services/pms/MockPMSProvider.js (Phase 6 spec §28) — the safe,
 * always-available simulation used whenever a practice is in Demo Mode
 * (or explicitly configured with pmsProvider:'mock').
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const MockPMSProvider = require('../services/pms/MockPMSProvider');
const { AppointmentNotFoundError, SlotUnavailableError } = require('../services/pms/PMSErrors');

const PRACTICE = { practiceId: 'p1', timezone: 'America/New_York', services: [{ id: 'cleaning', name: 'Cleaning' }], hours: { openDays: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '17:00', slotMinutes: 30 } };

test('isConfigured() is always true — the mock never needs real credentials', () => {
  assert.equal(new MockPMSProvider().isConfigured(), true);
});

test('testConnection() always succeeds and never reports as the real provider', () => {
  return new MockPMSProvider().testConnection(PRACTICE).then((r) => {
    assert.equal(r.success, true);
    assert.equal(r.provider, 'mock');
  });
});

test('PATIENT FOUND: a seeded patient is found by phone', async () => {
  const mock = new MockPMSProvider();
  const results = await mock.findPatients(PRACTICE, { phone: '+15551234567' });
  assert.equal(results.length, 1);
  assert.equal(results[0].firstName, 'Sarah');
});

test('PATIENT NOT FOUND: an unrecognized phone number returns an empty array, never a guess', async () => {
  const mock = new MockPMSProvider();
  const results = await mock.findPatients(PRACTICE, { phone: '+19995550000' });
  assert.deepEqual(results, []);
});

test('MULTIPLE MATCHES: two patients created with the same phone number both come back, letting the orchestration layer disambiguate', async () => {
  const mock = new MockPMSProvider();
  await mock.createPatient(PRACTICE, { firstName: 'Alex', lastName: 'One', phone: '+15550001111' });
  await mock.createPatient(PRACTICE, { firstName: 'Sam', lastName: 'Two', phone: '+15550001111' });
  const results = await mock.findPatients(PRACTICE, { phone: '+15550001111' });
  assert.equal(results.length, 2);
});

test('CREATE PATIENT: a new patient gets a distinct MOCK-prefixed id, never mistakable for a real Open Dental id', async () => {
  const mock = new MockPMSProvider();
  const created = await mock.createPatient(PRACTICE, { firstName: 'New', lastName: 'Patient', phone: '+15559990000' });
  assert.match(created.externalPatientId, /^MOCK-PAT-/);
});

test('AVAILABILITY: returns real generated slots for an open day, none for a closed day', async () => {
  const mock = new MockPMSProvider();
  const open = await mock.getAvailability(PRACTICE, { date: '2026-09-08' }); // Tuesday
  assert.ok(open.length > 0);
  const closed = await mock.getAvailability(PRACTICE, { date: '2026-09-06' }); // Sunday
  assert.deepEqual(closed, []);
});

test('BOOKING SUCCESS: createAppointment returns a MOCK-prefixed external appointment id', async () => {
  const mock = new MockPMSProvider();
  const appt = await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1001', date: '2026-09-08', time: '10:00 AM' });
  assert.match(appt.externalAppointmentId, /^MOCK-APT-/);
  assert.equal(appt.status, 'Scheduled');
});

test('BOOKING FAILURE (double-booking protection): a second appointment for the same date/time throws SlotUnavailableError', async () => {
  const mock = new MockPMSProvider();
  await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1001', date: '2026-09-08', time: '10:00 AM' });
  await assert.rejects(
    () => mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1002', date: '2026-09-08', time: '10:00 AM' }),
    SlotUnavailableError
  );
});

test('CANCELLATION: marks the appointment Cancelled and it no longer blocks that slot', async () => {
  const mock = new MockPMSProvider();
  const appt = await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1001', date: '2026-09-08', time: '10:00 AM' });
  const cancelled = await mock.cancelAppointment(PRACTICE, appt.externalAppointmentId);
  assert.equal(cancelled.status, 'Cancelled');
  // Re-booking the same slot after cancellation must now succeed.
  const rebooked = await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1002', date: '2026-09-08', time: '10:00 AM' });
  assert.equal(rebooked.status, 'Scheduled');
});

test('CANCELLATION of an unknown appointment throws AppointmentNotFoundError', async () => {
  const mock = new MockPMSProvider();
  await assert.rejects(() => mock.cancelAppointment(PRACTICE, 'MOCK-APT-99999'), AppointmentNotFoundError);
});

test('RESCHEDULE: moves the appointment and re-applies double-booking protection against the NEW slot', async () => {
  const mock = new MockPMSProvider();
  const a = await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1001', date: '2026-09-08', time: '10:00 AM' });
  await mock.createAppointment(PRACTICE, { externalPatientId: 'MOCK-PAT-1002', date: '2026-09-08', time: '11:00 AM' });
  await assert.rejects(() => mock.updateAppointment(PRACTICE, a.externalAppointmentId, { date: '2026-09-08', time: '11:00 AM' }), SlotUnavailableError);

  const moved = await mock.updateAppointment(PRACTICE, a.externalAppointmentId, { date: '2026-09-08', time: '1:00 PM' });
  assert.equal(moved.time, '1:00 PM');
});

test('RESCHEDULE of an unknown appointment throws AppointmentNotFoundError', async () => {
  const mock = new MockPMSProvider();
  await assert.rejects(() => mock.updateAppointment(PRACTICE, 'MOCK-APT-99999', { date: '2026-09-08', time: '10:00 AM' }), AppointmentNotFoundError);
});

test('PMS UNAVAILABLE simulation is not applicable to the mock (it never fails for connectivity reasons) — getPatientAppointments simply returns what exists', async () => {
  const mock = new MockPMSProvider();
  const patient = await mock.createPatient(PRACTICE, { firstName: 'A', lastName: 'B', phone: '+15551110000' });
  await mock.createAppointment(PRACTICE, { externalPatientId: patient.externalPatientId, date: '2026-09-08', time: '10:00 AM' });
  const appts = await mock.getPatientAppointments(PRACTICE, patient.externalPatientId);
  assert.equal(appts.length, 1);
});

test('PRACTICE ISOLATION: two different practiceIds never see each other\'s mock patients/appointments', async () => {
  const mock = new MockPMSProvider();
  const practiceA = { ...PRACTICE, practiceId: 'practice-a' };
  const practiceB = { ...PRACTICE, practiceId: 'practice-b' };
  const patientA = await mock.createPatient(practiceA, { firstName: 'A', lastName: 'Only', phone: '+15551110000' });
  const foundInB = await mock.findPatients(practiceB, { phone: '+15551110000' });
  assert.deepEqual(foundInB, []);
  const foundInA = await mock.findPatients(practiceA, { phone: '+15551110000' });
  assert.equal(foundInA.length, 1);
  assert.equal(foundInA[0].externalPatientId, patientA.externalPatientId);
});

test('getAppointmentTypes mirrors this practice\'s own services 1:1, never invented ids from nowhere', async () => {
  const mock = new MockPMSProvider();
  const types = await mock.getAppointmentTypes(PRACTICE);
  assert.equal(types.length, 1);
  assert.equal(types[0].externalAppointmentTypeId, 'MOCK-APPTTYPE-cleaning');
});
