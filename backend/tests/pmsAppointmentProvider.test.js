/**
 * services/pms/pmsAppointmentProvider.js (Phase 6 spec §7-§19/§27) — the
 * orchestration layer that turns PMSProvider-level operations into this
 * app's own AppointmentProvider interface. Every test injects fakes for
 * appointmentRepo/syncRepo/auditRepo/getPMSProvider so nothing here needs
 * a real database — same convention as
 * tests/googleCalendarProvider.test.js and tests/notificationService.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const PMSAppointmentProvider = require('../services/pms/pmsAppointmentProvider');
const MockPMSProvider = require('../services/pms/MockPMSProvider');
const {
  PatientNotFoundError,
  MultiplePatientMatchError,
  InvalidConfigurationError,
  SlotUnavailableError,
  BookingFailedError,
} = require('../services/pms/PMSErrors');

const PRACTICE = {
  practiceId: 'p1',
  timezone: 'America/New_York',
  services: [{ id: 'cleaning', name: 'Cleaning', duration: 30 }],
  hours: { openDays: [1, 2, 3, 4, 5], openTime: '09:00', closeTime: '17:00', slotMinutes: 30 },
  pms: { serviceMappings: {}, providerMappings: {}, operatoryMappings: {} },
};

function fakeAppointmentRepo() {
  const store = new Map();
  let seq = 1;
  return {
    store,
    async create(practiceId, data) {
      const id = String(seq++);
      const doc = { _id: id, practiceId, ...data };
      store.set(id, doc);
      return doc;
    },
    async findById(practiceId, id) {
      const d = store.get(String(id));
      return d && d.practiceId === practiceId ? d : null;
    },
    async update(practiceId, id, patch) {
      const d = store.get(String(id));
      if (!d) return null;
      Object.assign(d, patch);
      return d;
    },
    async findAll(practiceId) {
      return [...store.values()].filter((d) => d.practiceId === practiceId);
    },
  };
}

function fakeSyncRepo() {
  const links = [];
  return {
    links,
    async linkAppointment(practiceId, rec) {
      links.push({ practiceId, ...rec });
      return rec;
    },
    async findByExternalAppointmentId(practiceId, extId) {
      return links.find((l) => l.practiceId === practiceId && l.externalAppointmentId === extId) || null;
    },
    async updateStatus(practiceId, localAppointmentId, syncStatus) {
      const l = links.find((x) => x.practiceId === practiceId && x.localAppointmentId === localAppointmentId);
      if (l) l.syncStatus = syncStatus;
    },
  };
}

function fakeAuditRepo() {
  const events = [];
  return { events, record: async (practiceId, entry) => { events.push({ practiceId, ...entry }); return null; } };
}

function buildProvider(pms = new MockPMSProvider()) {
  const appointmentRepo = fakeAppointmentRepo();
  const syncRepo = fakeSyncRepo();
  const auditRepo = fakeAuditRepo();
  const provider = new PMSAppointmentProvider({ getPMSProvider: () => pms, appointmentRepo, syncRepo, auditRepo });
  return { provider, appointmentRepo, syncRepo, auditRepo, pms };
}

test('BOOKING SUCCESS (new patient): resolves/creates a PMS patient, books, links a sync record, and returns the confirmed local appointment', async () => {
  const { provider, syncRepo, auditRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const appt = await provider.createAppointment(PRACTICE, {
    name: 'Jane Doe', phone: '+15559990000', email: 'jane@example.com', service: 'Cleaning', serviceId: 'cleaning',
    date: '2026-09-08', time: avail.slots[0].time, patientType: 'new',
  });
  assert.equal(appt.status, 'Confirmed');
  assert.equal(appt.pmsProvider, 'mock');
  assert.match(appt.pmsAppointmentId, /^MOCK-APT-/);
  assert.equal(syncRepo.links.length, 1);
  assert.ok(auditRepo.events.some((e) => e.event === 'booking_succeeded'));
});

test('BOOKING SUCCESS (existing patient): matches the seeded patient by phone rather than creating a duplicate', async () => {
  const { provider, pms } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const appt = await provider.createAppointment(PRACTICE, {
    name: 'Sarah Ahmed', phone: '+15551234567', service: 'Cleaning', serviceId: 'cleaning',
    date: '2026-09-08', time: avail.slots[0].time, patientType: 'existing',
  });
  assert.equal(appt.pmsPatientId, 'MOCK-PAT-1001'); // the seeded patient, not a newly created one
});

test('BOOKING FAILURE -> NO appointment confirmation: a stale/already-taken slot throws SlotUnavailableError and never creates a local record', async () => {
  const { provider, appointmentRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const time = avail.slots[0].time;
  await provider.createAppointment(PRACTICE, { name: 'A B', phone: '+15550001111', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time, patientType: 'new' });

  await assert.rejects(
    () => provider.createAppointment(PRACTICE, { name: 'C D', phone: '+15550002222', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time, patientType: 'new' }),
    SlotUnavailableError
  );
  assert.equal(appointmentRepo.store.size, 1, 'the second, failed booking attempt must never create a local record');
});

test('PATIENT NOT FOUND: patientType "existing" with no PMS match throws PatientNotFoundError, never silently books as new', async () => {
  const { provider } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  await assert.rejects(
    () => provider.createAppointment(PRACTICE, { name: 'Nobody Here', phone: '+19995551234', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'existing' }),
    PatientNotFoundError
  );
});

test('MULTIPLE PATIENT MATCH: two different patients sharing one phone number, with no name match, throws MultiplePatientMatchError rather than guessing', async () => {
  const { provider, pms } = buildProvider();
  await pms.createPatient(PRACTICE, { firstName: 'Alex', lastName: 'One', phone: '+15550009999' });
  await pms.createPatient(PRACTICE, { firstName: 'Sam', lastName: 'Two', phone: '+15550009999' });
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  await assert.rejects(
    () => provider.createAppointment(PRACTICE, { name: 'Someone Else', phone: '+15550009999', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' }),
    MultiplePatientMatchError
  );
});

test('MULTIPLE PATIENT MATCH is narrowed by last name when the caller-supplied name matches one of the shared-phone patients', async () => {
  const { provider, pms } = buildProvider();
  await pms.createPatient(PRACTICE, { firstName: 'Alex', lastName: 'One', phone: '+15550009998' });
  await pms.createPatient(PRACTICE, { firstName: 'Sam', lastName: 'Two', phone: '+15550009998' });
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const appt = await provider.createAppointment(PRACTICE, { name: 'Alex One', phone: '+15550009998', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'existing' });
  assert.equal(appt.status, 'Confirmed');
});

test('NEVER EXPOSES UNRELATED PATIENTS: MultiplePatientMatchError carries only a count, never the other patients\' records', async () => {
  const { provider, pms } = buildProvider();
  await pms.createPatient(PRACTICE, { firstName: 'Alex', lastName: 'One', phone: '+15550009997' });
  await pms.createPatient(PRACTICE, { firstName: 'Sam', lastName: 'Two', phone: '+15550009997' });
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  try {
    await provider.createAppointment(PRACTICE, { name: 'Nobody Matching', phone: '+15550009997', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' });
    assert.fail('expected MultiplePatientMatchError');
  } catch (err) {
    assert.equal(err.matchCount, 2);
    assert.equal(err.firstName, undefined);
    assert.equal(err.lastName, undefined);
  }
});

test('SERVICE MAPPING MISSING: a real (non-mock) PMS with no configured mapping for a service throws InvalidConfigurationError, never guesses', async () => {
  const { provider, pms } = buildProvider();
  // Force this to look like the "real provider, no mapping configured" case.
  Object.defineProperty(pms, 'providerName', { value: 'openDental', configurable: true });
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  await assert.rejects(
    () => provider.createAppointment(PRACTICE, { name: 'A B', phone: '+15551110000', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' }),
    InvalidConfigurationError
  );
});

test('SERVICE MAPPING CONFIGURED: an explicit admin mapping is used instead of guessing', async () => {
  const { provider, pms } = buildProvider();
  Object.defineProperty(pms, 'providerName', { value: 'openDental', configurable: true });
  let capturedTypeId = null;
  const originalCreate = pms.createAppointment.bind(pms);
  pms.createAppointment = async (practice, data) => {
    capturedTypeId = data.appointmentTypeId;
    return originalCreate(practice, data);
  };
  const practiceWithMapping = { ...PRACTICE, pms: { serviceMappings: { cleaning: { openDentalAppointmentTypeNum: '777' } }, providerMappings: {}, operatoryMappings: {} } };
  const avail = await provider.getAvailability(practiceWithMapping, '2026-09-08', {});
  await provider.createAppointment(practiceWithMapping, { name: 'A B', phone: '+15551110001', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' });
  assert.equal(capturedTypeId, '777');
});

test('RESCHEDULE SUCCESS: only sent (and only updates local state) after the PMS confirms the new slot', async () => {
  const { provider, syncRepo } = buildProvider();
  const avail1 = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const appt = await provider.createAppointment(PRACTICE, { name: 'A B', phone: '+15551110002', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail1.slots[0].time, patientType: 'new' });

  const avail2 = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const newTime = avail2.slots.find((s) => s.time !== appt.time).time;
  const updated = await provider.rescheduleAppointment(PRACTICE, appt._id, { time: newTime });
  assert.equal(updated.status, 'Rescheduled');
  assert.equal(updated.time, newTime);
  assert.equal(syncRepo.links.find((l) => l.localAppointmentId === appt._id).syncStatus, 'rescheduled');
});

test('RESCHEDULE FAILURE: a conflicting new slot throws SlotUnavailableError and leaves the original appointment untouched', async () => {
  const { provider, appointmentRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const apptA = await provider.createAppointment(PRACTICE, { name: 'A', phone: '+15551110003', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' });
  const apptB = await provider.createAppointment(PRACTICE, { name: 'B', phone: '+15551110004', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[1].time, patientType: 'new' });

  await assert.rejects(() => provider.rescheduleAppointment(PRACTICE, apptA._id, { time: avail.slots[1].time }), SlotUnavailableError);
  const stillOriginal = await appointmentRepo.findById(PRACTICE.practiceId, apptA._id);
  assert.equal(stillOriginal.time, avail.slots[0].time, 'a failed reschedule must never change the original appointment');
});

test('CANCEL SUCCESS: cancels in the PMS first, then marks the local record Cancelled', async () => {
  const { provider, syncRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const appt = await provider.createAppointment(PRACTICE, { name: 'A B', phone: '+15551110005', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' });
  const cancelled = await provider.cancelAppointment(PRACTICE, appt._id);
  assert.equal(cancelled.status, 'Cancelled');
  assert.equal(syncRepo.links.find((l) => l.localAppointmentId === appt._id).syncStatus, 'cancelled');
});

test('CANCEL on a non-PMS-backed appointment (never linked) still marks it cancelled locally without calling the PMS', async () => {
  const { provider, appointmentRepo } = buildProvider();
  const doc = await appointmentRepo.create(PRACTICE.practiceId, { name: 'Old', phone: '+15550000000', date: '2026-09-08', time: '9:00 AM', status: 'Confirmed' });
  const cancelled = await provider.cancelAppointment(PRACTICE, doc._id);
  assert.equal(cancelled.status, 'Cancelled');
});

test('SEARCH (existing patient): resolves patient by phone then returns matching local appointments via the sync map', async () => {
  const { provider } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  await provider.createAppointment(PRACTICE, { name: 'Sarah Ahmed', phone: '+15551234567', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'existing' });
  const results = await provider.searchAppointments(PRACTICE, '+15551234567');
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'Confirmed');
});

test('SEARCH (no match / ambiguous): never guesses — returns an empty list rather than someone else\'s appointments', async () => {
  const { provider, pms } = buildProvider();
  await pms.createPatient(PRACTICE, { firstName: 'A', lastName: 'One', phone: '+15550009996' });
  await pms.createPatient(PRACTICE, { firstName: 'B', lastName: 'Two', phone: '+15550009996' });
  const results = await provider.searchAppointments(PRACTICE, '+15550009996');
  assert.deepEqual(results, []);
});

test('AUDIT LOGGING: patient_lookup and booking_succeeded events are recorded with safe metadata only (no message bodies/secrets)', async () => {
  const { provider, auditRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  await provider.createAppointment(PRACTICE, { name: 'A B', phone: '+15551110006', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: avail.slots[0].time, patientType: 'new' });
  const events = auditRepo.events.map((e) => e.event);
  assert.ok(events.includes('patient_lookup'));
  assert.ok(events.includes('patient_created'));
  assert.ok(events.includes('booking_succeeded'));
  assert.ok(events.includes('availability_lookup'));
  for (const e of auditRepo.events) {
    assert.equal(e.name, undefined);
    assert.equal(e.phone, undefined);
  }
});

test('BOOKING FAILURE audit: a failed booking records booking_failed with a failure reason, never a fabricated success event', async () => {
  const { provider, auditRepo } = buildProvider();
  const avail = await provider.getAvailability(PRACTICE, '2026-09-08', {});
  const time = avail.slots[0].time;
  await provider.createAppointment(PRACTICE, { name: 'A', phone: '+15551110007', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time, patientType: 'new' });
  await assert.rejects(() => provider.createAppointment(PRACTICE, { name: 'B', phone: '+15551110008', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time, patientType: 'new' }));
  assert.ok(auditRepo.events.some((e) => e.event === 'booking_failed' && e.failureReason));
});

test('PRACTICE ISOLATION: two practices booking through the same PMS instance never see each other\'s local appointments', async () => {
  const pms = new MockPMSProvider();
  const { provider } = buildProvider(pms);
  const practiceA = { ...PRACTICE, practiceId: 'practice-a' };
  const practiceB = { ...PRACTICE, practiceId: 'practice-b' };
  const availA = await provider.getAvailability(practiceA, '2026-09-08', {});
  const availB = await provider.getAvailability(practiceB, '2026-09-08', {});
  await provider.createAppointment(practiceA, { name: 'A', phone: '+15551110009', service: 'Cleaning', serviceId: 'cleaning', date: '2026-09-08', time: availA.slots[0].time, patientType: 'new' });
  const allA = await provider.getAllAppointments(practiceA);
  const allB = await provider.getAllAppointments(practiceB);
  assert.equal(allA.length, 1);
  assert.equal(allB.length, 0);
});
