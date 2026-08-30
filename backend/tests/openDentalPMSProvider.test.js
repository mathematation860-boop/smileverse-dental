/**
 * services/pms/OpenDentalPMSProvider.js (Phase 6 spec §29) — comprehensive
 * tests using a fake `fetch` implementation injected via the constructor.
 * NEVER requires real Open Dental credentials — mirrors
 * tests/notificationProviders.test.js's approach to TwilioSMSProvider/
 * SendGridEmailProvider for the same reason (no real accounts reachable
 * in this environment).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const OpenDentalPMSProvider = require('../services/pms/OpenDentalPMSProvider');
const {
  PMSUnavailableError,
  PatientCreationFailedError,
  AppointmentNotFoundError,
  BookingFailedError,
  CancellationFailedError,
  RescheduleFailedError,
  SlotUnavailableError,
} = require('../services/pms/PMSErrors');

function fakeFetch(sequence) {
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = sequence[Math.min(i, sequence.length - 1)];
    i++;
    if (r.throw) throw r.throw;
    return { status: r.status, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) };
  };
  fn.calls = calls;
  return fn;
}

test('isConfigured() is false without both a developer key and a customer key', () => {
  assert.equal(new OpenDentalPMSProvider({ developerKey: null, customerKey: 'c' }).isConfigured(), false);
  assert.equal(new OpenDentalPMSProvider({ developerKey: 'd', customerKey: null }).isConfigured(), false);
  assert.equal(new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c' }).isConfigured(), true);
});

test('AUTH HEADER: every request carries the exact "ODFHIR {dev}/{customer}" Authorization header', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'DEVKEY', customerKey: 'CUSTKEY', fetchImpl });
  await provider.findPatients({}, { phone: '+15551234567' });
  assert.equal(fetchImpl.calls[0].opts.headers.Authorization, 'ODFHIR DEVKEY/CUSTKEY');
});

test('ENDPOINT CONSTRUCTION: findPatients builds GET /patients with the documented query parameters', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await provider.findPatients({}, { firstName: 'Jane', lastName: 'Doe', phone: '+15551234567', dateOfBirth: '1990-01-01', email: 'j@x.com' });
  const url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, '/api/v1/patients');
  assert.equal(fetchImpl.calls[0].opts.method, 'GET');
  assert.equal(url.searchParams.get('FName'), 'Jane');
  assert.equal(url.searchParams.get('LName'), 'Doe');
  assert.equal(url.searchParams.get('Phone'), '+15551234567');
  assert.equal(url.searchParams.get('Birthdate'), '1990-01-01');
  assert.equal(url.searchParams.get('Email'), 'j@x.com');
});

test('ENDPOINT CONSTRUCTION: createAppointment POSTs to /appointments with PatNum/Op/ProvNum/AptDateTime/AppointmentTypeNum', async () => {
  const fetchImpl = fakeFetch([{ status: 201, body: { AptNum: 999, PatNum: 42, AptDateTime: '2026-09-08 14:00:00', AptStatus: 'Scheduled' } }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  const result = await provider.createAppointment({}, { externalPatientId: '42', date: '2026-09-08', time24: '14:00', providerId: '1', operatoryId: '2', appointmentTypeId: '5' });
  const call = fetchImpl.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/v1/appointments');
  assert.equal(call.opts.method, 'POST');
  const body = JSON.parse(call.opts.body);
  assert.equal(body.PatNum, 42);
  assert.equal(body.Op, 2);
  assert.equal(body.ProvNum, 1);
  assert.equal(body.AptDateTime, '2026-09-08 14:00:00');
  assert.equal(body.AppointmentTypeNum, 5);
  assert.equal(result.externalAppointmentId, '999');
});

test('ENDPOINT CONSTRUCTION: cancelAppointment PUTs to /appointments/{AptNum}/Break, never DELETE', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { AptNum: 999, AptStatus: 'Broken' } }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await provider.cancelAppointment({}, '999');
  const call = fetchImpl.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/v1/appointments/999/Break');
  assert.equal(call.opts.method, 'PUT');
});

test('ENDPOINT CONSTRUCTION: updateAppointment PUTs to /appointments/{AptNum} for a reschedule', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: { AptNum: 999, AptDateTime: '2026-09-09 10:00:00', AptStatus: 'Scheduled' } }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await provider.updateAppointment({}, '999', { date: '2026-09-09', time24: '10:00' });
  const call = fetchImpl.calls[0];
  assert.equal(new URL(call.url).pathname, '/api/v1/appointments/999');
  assert.equal(call.opts.method, 'PUT');
});

test('HTTP 400: createPatient with a bad response throws PatientCreationFailedError', async () => {
  const fetchImpl = fakeFetch([{ status: 400, body: { error: 'bad request' } }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.createPatient({}, { firstName: 'A', lastName: 'B' }), PatientCreationFailedError);
});

test('HTTP 401: any request throws PMSUnavailableError with reason auth_failed', async () => {
  const fetchImpl = fakeFetch([{ status: 401 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'auth_failed');
});

test('HTTP 403: also treated as an auth failure', async () => {
  const fetchImpl = fakeFetch([{ status: 403 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'auth_failed');
});

test('HTTP 404: updateAppointment throws AppointmentNotFoundError', async () => {
  const fetchImpl = fakeFetch([{ status: 404 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.updateAppointment({}, '999', { date: '2026-09-09', time24: '10:00' }), AppointmentNotFoundError);
});

test('HTTP 404: cancelAppointment throws AppointmentNotFoundError', async () => {
  const fetchImpl = fakeFetch([{ status: 404 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.cancelAppointment({}, '999'), AppointmentNotFoundError);
});

test('HTTP 409: createAppointment throws SlotUnavailableError (busy) — never a generic failure', async () => {
  const fetchImpl = fakeFetch([{ status: 409 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.createAppointment({}, { externalPatientId: '1', date: '2026-09-08', time24: '10:00' }), SlotUnavailableError);
});

test('HTTP 409: updateAppointment (reschedule) also throws SlotUnavailableError', async () => {
  const fetchImpl = fakeFetch([{ status: 409 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.updateAppointment({}, '1', { date: '2026-09-08', time24: '10:00' }), SlotUnavailableError);
});

test('HTTP 429: rate-limited requests throw PMSUnavailableError, never treated as a normal failure', async () => {
  const fetchImpl = fakeFetch([{ status: 429 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'rate_limited');
});

test('HTTP 500: server errors throw PMSUnavailableError', async () => {
  const fetchImpl = fakeFetch([{ status: 500 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'server_error');
});

test('MALFORMED RESPONSE: unparseable JSON body degrades to "no usable data" rather than throwing a parse error', async () => {
  const fetchImpl = async () => ({ status: 200, text: async () => '{not json' });
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  const result = await provider.findPatients({}, {});
  assert.deepEqual(result, []);
});

test('MISSING REQUIRED FIELD: createAppointment response missing AptNum is treated as a booking failure, never a fabricated success', async () => {
  const fetchImpl = fakeFetch([{ status: 201, body: { PatNum: 1 } }]); // no AptNum
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.createAppointment({}, { externalPatientId: '1', date: '2026-09-08', time24: '10:00' }), BookingFailedError);
});

test('TIMEOUT: an aborted request throws PMSUnavailableError with reason timeout', async () => {
  const slowFetch = () =>
    new Promise((_, reject) => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      setTimeout(() => reject(err), 5);
    });
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', timeoutMs: 1, fetchImpl: slowFetch });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'timeout');
});

test('NETWORK ERROR: a rejected fetch (e.g. DNS failure) throws PMSUnavailableError with reason network_error', async () => {
  const brokenFetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND');
  };
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl: brokenFetch });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'network_error');
});

test('NOT CONFIGURED: any operation throws PMSUnavailableError immediately, never attempts a network call', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { status: 200, text: async () => '[]' };
  };
  const provider = new OpenDentalPMSProvider({ developerKey: null, customerKey: null, fetchImpl });
  await assert.rejects(() => provider.findPatients({}, {}), (err) => err instanceof PMSUnavailableError && err.reason === 'not_configured');
  assert.equal(called, false);
});

test('testConnection() never creates or modifies anything — a GET only, never POST/PUT', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  const result = await provider.testConnection({});
  assert.equal(result.success, true);
  assert.equal(fetchImpl.calls[0].opts.method, 'GET');
  assert.equal(result.provider, 'openDental');
});

test('testConnection() never leaks the developer/customer key in its result', async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: [] }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'SECRET_DEV', customerKey: 'SECRET_CUST', fetchImpl });
  const result = await provider.testConnection({});
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('SECRET_DEV'));
  assert.ok(!serialized.includes('SECRET_CUST'));
});

test('reschedule failure (non-409, non-404, non-2xx) throws RescheduleFailedError', async () => {
  const fetchImpl = fakeFetch([{ status: 400 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.updateAppointment({}, '1', { date: '2026-09-08', time24: '10:00' }), RescheduleFailedError);
});

test('cancellation failure (non-404, non-2xx) throws CancellationFailedError', async () => {
  const fetchImpl = fakeFetch([{ status: 400 }]);
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  await assert.rejects(() => provider.cancelAppointment({}, '1'), CancellationFailedError);
});

test('getAppointmentTypes() degrades to an empty list rather than throwing, since this endpoint is lower-confidence/optional', async () => {
  const fetchImpl = async () => ({ status: 500, text: async () => '' });
  const provider = new OpenDentalPMSProvider({ developerKey: 'd', customerKey: 'c', fetchImpl });
  const types = await provider.getAppointmentTypes({});
  assert.deepEqual(types, []);
});
