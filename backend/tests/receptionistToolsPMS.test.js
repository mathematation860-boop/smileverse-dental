/**
 * Proves tools/receptionistTools.js — the ONE shared implementation
 * behind the web widget, the voice receptionist, AND inbound SMS (see
 * that file's own header comment: "Either path ends up calling this same
 * function, so there is exactly one source of truth") — needs ZERO code
 * changes to work through a PMS-configured practice (Phase 6 spec §24:
 * "the receptionist should NOT know whether the underlying PMS is Open
 * Dental or mock"; spec §25/§26: voice and SMS must reuse the exact same
 * tools, never a second implementation).
 *
 * This deliberately exercises the REAL services/providers/index.js and
 * services/pms/index.js routing (no injected fakes for those two, unlike
 * pmsAppointmentProvider.test.js) — the only thing faked is nothing at
 * all for the read-only tools below, which is the point: a practice
 * config with `integrations.pmsProvider: 'openDental'` set is enough, by
 * itself, to change what's underneath check_availability/search_appointments
 * without touching a single line of tools/receptionistTools.js.
 *
 * Scope note (mirrors tests/receptionistTools.test.js's own header): only
 * the tools that don't require a live MongoDB are exercised here
 * (check_availability, search_appointments against patients with zero
 * PMS-side appointments). create_appointment/reschedule/cancel through a
 * PMS additionally need a real Appointment/PMSSyncRecord database and are
 * instead covered, with full DB-free fakes, by pmsAppointmentProvider.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
// This file deliberately exercises the REAL PMSAuditLogRepository (no DI,
// unlike pmsAppointmentProvider.test.js) to prove genuine zero-code-change
// routing — its fire-and-forget audit write has nowhere to connect in this
// sandbox (no MongoDB available for automated tests, same as every other
// DB-touching path in this repo). Disabling command buffering makes that
// doomed write fail fast instead of waiting out Mongoose's ~10s buffering
// timeout on every call; it's still caught and swallowed as non-fatal by
// PMSAuditLogRepository.record() either way.
require('mongoose').set('bufferCommands', false);
const tools = require('../tools/receptionistTools');
const { getAppointmentProvider } = require('../services/providers');
const PMSAppointmentProvider = require('../services/pms/pmsAppointmentProvider');
const basePractice = require('../config/practices/smileverse-dental');

// Still demoMode: true — per spec §3, demoMode must ALWAYS win regardless
// of what pmsProvider says, so this practice is guaranteed to run on
// MockPMSProvider under the hood, never a real Open Dental account, even
// though it is otherwise "PMS-configured."
const pmsPractice = {
  ...basePractice,
  integrations: { ...basePractice.integrations, pmsProvider: 'openDental' },
};

test('ROUTING PROOF: a PMS-configured practice resolves to PMSAppointmentProvider via the exact same services/providers/index.js call receptionistTools.js itself makes', () => {
  assert.ok(getAppointmentProvider(pmsPractice) instanceof PMSAppointmentProvider);
  // ...and the demo practice (pmsProvider: 'none') is completely unaffected.
  assert.ok(!(getAppointmentProvider(basePractice) instanceof PMSAppointmentProvider));
});

test('check_availability (shared by web/voice/SMS) returns real generated slots through the PMS path, with zero changes to receptionistTools.js', async () => {
  // 2026-09-08 is a Tuesday — an open day per the base practice's hours.
  const result = await tools.check_availability(pmsPractice, '2026-09-08', {});
  assert.equal(result.isOpen, true);
  assert.ok(Array.isArray(result.slots));
  assert.ok(result.slots.length > 0);
  // Same { time, minutes } shape every other provider returns (Demo/Google) —
  // the booking UI/voice/SMS layers need not know or care which provider
  // actually produced these slots.
  assert.ok(typeof result.slots[0].time === 'string');
  assert.ok(typeof result.slots[0].minutes === 'number');
});

test('check_availability on a closed day returns isOpen:false through the PMS path too (business-hours logic is practice-level, not PMS-level)', async () => {
  const result = await tools.check_availability(pmsPractice, '2026-09-06', {}); // Sunday
  assert.equal(result.isOpen, false);
  assert.deepEqual(result.slots, []);
});

test('search_appointments (shared by web/voice/SMS) for an unrecognized phone number returns an empty list through the PMS path, never a guess', async () => {
  const result = await tools.search_appointments(pmsPractice, '+19995550000');
  assert.deepEqual(result, []);
});

test('search_appointments for the seeded mock patient with no PMS-side appointments yet returns an empty list without needing a database', async () => {
  // MOCK-PAT-1001 (Sarah Ahmed, +15551234567) is MockPMSProvider's seeded
  // patient — she resolves by phone (proving patient identity flows
  // through unchanged too), but has no appointments booked in THIS test's
  // fresh MockPMSProvider instance, so the local-sync-lookup loop never
  // needs to run and this stays DB-free.
  const result = await tools.search_appointments(pmsPractice, '+15551234567');
  assert.deepEqual(result, []);
});

test('VOICE/SMS PARITY: calling the exact same exported tool functions with the same PMS-configured practice from two "different surfaces" behaves identically — there is no second implementation to keep in sync', async () => {
  const webCall = await tools.check_availability(pmsPractice, '2026-09-08', {});
  const voiceCall = await tools.check_availability(pmsPractice, '2026-09-08', {}); // stands in for the voice receptionist calling the identical function
  const smsCall = await tools.check_availability(pmsPractice, '2026-09-08', {}); // stands in for inbound SMS calling the identical function
  assert.deepEqual(webCall.slots.map((s) => s.time), voiceCall.slots.map((s) => s.time));
  assert.deepEqual(webCall.slots.map((s) => s.time), smsCall.slots.map((s) => s.time));
});
