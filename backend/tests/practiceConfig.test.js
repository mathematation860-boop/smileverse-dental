/**
 * Practice configuration completeness — Phase 1 asked for every
 * clinic-specific fact (name, phone, email, address, timezone, hours,
 * services/prices/durations, insurance providers, FAQs, policies) to live
 * in one clean config/data layer instead of being scattered or
 * hard-coded across frontend components. This test is the contract for
 * that: it fails loudly if a required field goes missing from a practice
 * record, which is exactly the kind of regression that would otherwise
 * only be noticed as a blank spot in the UI much later.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const practice = require('../config/practices/smileverse-dental');
const { getPractice, getDefaultPracticeId, listPracticeIds } = require('../config/practiceRepository');

test('practice config: SmileVerse Dental is registered and is the default demo practice', () => {
  assert.ok(listPracticeIds().includes('smileverse-dental'));
  assert.equal(getDefaultPracticeId(), 'smileverse-dental');
  assert.equal(getPractice('smileverse-dental').name, 'SmileVerse Dental');
});

test('practice config: core identity/contact fields are all present', () => {
  assert.equal(typeof practice.name, 'string');
  assert.ok(practice.name.length > 0);
  assert.equal(typeof practice.phone, 'string');
  assert.equal(typeof practice.email, 'string');
  assert.match(practice.email, /@/);
  assert.equal(typeof practice.address, 'string');
  assert.equal(typeof practice.timezone, 'string');
  // Must be a real IANA zone, not a made-up label — a bad value here would
  // silently break every availability/scheduling calculation.
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en-US', { timeZone: practice.timezone }));
});

test('practice config: business hours are fully specified', () => {
  assert.equal(typeof practice.hours.display, 'string');
  assert.ok(Array.isArray(practice.hours.openDays) && practice.hours.openDays.length > 0);
  assert.match(practice.hours.openTime, /^\d{2}:\d{2}$/);
  assert.match(practice.hours.closeTime, /^\d{2}:\d{2}$/);
  assert.equal(typeof practice.hours.slotMinutes, 'number');
});

test('practice config: every service has an id, name, and duration; priced services have a numeric price', () => {
  assert.ok(Array.isArray(practice.services) && practice.services.length > 0);
  practice.services.forEach((s) => {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.duration, 'number');
    assert.ok(s.price === null || typeof s.price === 'number');
  });
  // At least one fixed-price and one priced-after-evaluation service, since
  // both categories are exercised elsewhere (booking flow, price guard).
  assert.ok(practice.services.some((s) => typeof s.price === 'number'));
  assert.ok(practice.services.some((s) => s.price === null));
});

test('practice config: insurance providers list is present and non-empty', () => {
  assert.ok(Array.isArray(practice.insurance.acceptedProviders));
  assert.ok(practice.insurance.acceptedProviders.length > 0);
  assert.equal(typeof practice.insurance.notes, 'string');
});

test('practice config: FAQs are present with at least one category and one Q&A item', () => {
  assert.ok(Array.isArray(practice.faqs) && practice.faqs.length > 0);
  const firstCategory = practice.faqs[0];
  assert.ok(Array.isArray(firstCategory.items) && firstCategory.items.length > 0);
  assert.equal(typeof firstCategory.items[0].question, 'string');
  assert.equal(typeof firstCategory.items[0].answer, 'string');
});

test('practice config: cancellation and emergency policies are present', () => {
  assert.equal(typeof practice.cancellationPolicy.summary, 'string');
  assert.ok(practice.cancellationPolicy.summary.length > 0);
  assert.equal(typeof practice.emergencyPolicy.summary, 'string');
  assert.ok(practice.emergencyPolicy.summary.length > 0);
});

test('practice config: demoMode is an explicit boolean, not inferred', () => {
  assert.equal(typeof practice.demoMode, 'boolean');
});
