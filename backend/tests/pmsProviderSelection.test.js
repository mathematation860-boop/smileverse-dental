/**
 * services/pms/index.js's demoMode-gated factory (Phase 6 spec §3) —
 * mirrors tests/notificationProviderSelection.test.js's structure.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { getPMSProvider, isPmsEnabled } = require('../services/pms');
const MockPMSProvider = require('../services/pms/MockPMSProvider');
const OpenDentalPMSProvider = require('../services/pms/OpenDentalPMSProvider');

test('DEMO MODE ALWAYS WINS: a practice with demoMode true always gets the mock provider, even if pmsProvider says openDental', () => {
  const practice = { demoMode: true, integrations: { pmsProvider: 'openDental' } };
  assert.ok(getPMSProvider(practice) instanceof MockPMSProvider);
});

test('a practice with demoMode false AND pmsProvider openDental gets the real adapter', () => {
  const practice = { demoMode: false, integrations: { pmsProvider: 'openDental' } };
  assert.ok(getPMSProvider(practice) instanceof OpenDentalPMSProvider);
});

test('a practice with demoMode false AND pmsProvider mock gets the mock provider (safe way to test the PMS-shaped flow without real credentials)', () => {
  const practice = { demoMode: false, integrations: { pmsProvider: 'mock' } };
  assert.ok(getPMSProvider(practice) instanceof MockPMSProvider);
});

test('a practice with pmsProvider "none" gets null — PMS is simply not in play for this practice', () => {
  const practice = { demoMode: false, integrations: { pmsProvider: 'none' } };
  assert.equal(getPMSProvider(practice), null);
});

test('an unrecognized pmsProvider value falls back to the mock provider rather than pretending a real integration exists', () => {
  const practice = { demoMode: false, integrations: { pmsProvider: 'dentrix' } };
  assert.ok(getPMSProvider(practice) instanceof MockPMSProvider);
});

test('isPmsEnabled reflects the raw config switch regardless of demoMode', () => {
  assert.equal(isPmsEnabled({ integrations: { pmsProvider: 'openDental' } }), true);
  assert.equal(isPmsEnabled({ integrations: { pmsProvider: 'none' } }), false);
  assert.equal(isPmsEnabled({ integrations: {} }), false);
  assert.equal(isPmsEnabled({}), false);
});

test('the singleton OpenDentalPMSProvider instance is reused across calls (no per-request construction cost)', () => {
  const practice = { demoMode: false, integrations: { pmsProvider: 'openDental' } };
  assert.equal(getPMSProvider(practice), getPMSProvider(practice));
});
