/**
 * Pure decision logic for the real Google Calendar integration (Phase 2)
 * — slot generation, conflict detection, timezone conversion, business
 * hours, and service duration. No network call, no Mongoose, no
 * `googleapis` anywhere in the code under test, so every scenario here
 * runs deterministically without a live Google account or database (see
 * services/providers/googleCalendarLogic.js for why this is split out).
 *
 * Test dates are fixed, far-future weekdays (2030, a Wednesday) so these
 * assertions never flip from "upcoming" to "in the past" as time passes:
 * 2030-01-16 (January -> America/New_York is on EST, UTC-5) and
 * 2030-06-19 (June -> EDT, UTC-4) — deliberately different seasons so the
 * timezone tests actually exercise the DST-aware offset calculation
 * instead of a single hard-coded number.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const practice = require('../config/practices/smileverse-dental');
const { zonedWallTimeToUtc } = require('../utils/timezone');
const {
  getServiceDuration,
  intervalsOverlap,
  isSlotFree,
  computeSlotWindowUtc,
  isWithinBusinessHours,
  computeAvailableSlots,
} = require('../services/providers/googleCalendarLogic');

const WINTER_DATE = '2030-01-16'; // Wed, EST (UTC-5)
const SUMMER_DATE = '2030-06-19'; // Wed, EDT (UTC-4)
const CLOSED_DAY = '2030-06-22'; // Sat — practice.hours.openDays is Mon-Fri only

test('timezone conversion: winter (EST, UTC-5) wall-clock time converts to the correct UTC instant', () => {
  const utc = zonedWallTimeToUtc(WINTER_DATE, '09:00', practice.timezone);
  assert.equal(utc.toISOString(), '2030-01-16T14:00:00.000Z');
});

test('timezone conversion: summer (EDT, UTC-4) wall-clock time converts to a different UTC instant for the same local hour', () => {
  const utc = zonedWallTimeToUtc(SUMMER_DATE, '09:00', practice.timezone);
  assert.equal(utc.toISOString(), '2030-06-19T13:00:00.000Z');
});

test('service duration: a configured service uses its own duration, not the practice default slot length', () => {
  assert.equal(getServiceDuration(practice, 'root_canal', practice.hours.slotMinutes), 90);
  assert.equal(getServiceDuration(practice, 'cleaning', practice.hours.slotMinutes), 45);
});

test('service duration: an unknown/missing serviceId falls back to the practice default slot length', () => {
  assert.equal(getServiceDuration(practice, 'not_a_real_service', practice.hours.slotMinutes), practice.hours.slotMinutes);
  assert.equal(getServiceDuration(practice, undefined, practice.hours.slotMinutes), practice.hours.slotMinutes);
});

test('outside business hours: a time before opening is rejected', () => {
  assert.equal(isWithinBusinessHours(practice, SUMMER_DATE, '8:00 AM', 30), false);
});

test('outside business hours: a service that would run past closing time is rejected even though it STARTS before close', () => {
  // Practice closes at 17:00. A 60-minute service starting at 4:45 PM would end at 5:45 PM.
  assert.equal(isWithinBusinessHours(practice, SUMMER_DATE, '4:45 PM', 60), false);
  // The same start time with a service short enough to finish by close is fine.
  assert.equal(isWithinBusinessHours(practice, SUMMER_DATE, '4:45 PM', 15), true);
});

test('outside business hours: a closed day (Saturday) is rejected regardless of the requested time', () => {
  assert.equal(isWithinBusinessHours(practice, CLOSED_DAY, '10:00 AM', 30), false);
});

test('available slot: with no real busy intervals, the normal business-hours grid is offered', () => {
  const slots = computeAvailableSlots(practice, SUMMER_DATE, [], { durationMinutes: 30 });
  const labels = slots.map((s) => s.time);
  assert.ok(labels.includes('9:00 AM'), 'expected the first open slot to be available');
  assert.ok(labels.includes('4:30 PM'), 'expected the last 30-minute slot before 5 PM close to be available');
  assert.ok(!labels.includes('5:00 PM'), 'closing time itself is not a bookable start');
});

test('busy slot: a real Google Calendar busy interval removes exactly the overlapping slot(s)', () => {
  const busyStart = zonedWallTimeToUtc(SUMMER_DATE, '09:00', practice.timezone);
  const busyEnd = zonedWallTimeToUtc(SUMMER_DATE, '09:30', practice.timezone);
  const slots = computeAvailableSlots(practice, SUMMER_DATE, [{ start: busyStart, end: busyEnd }], { durationMinutes: 30 });
  const labels = slots.map((s) => s.time);
  assert.ok(!labels.includes('9:00 AM'), 'the busy slot must be excluded');
  assert.ok(labels.includes('9:30 AM'), 'the very next slot is unaffected');
});

test('service duration changes which slots are offered: a 90-minute service excludes a late-afternoon start a 30-minute service would allow', () => {
  const shortService = computeAvailableSlots(practice, SUMMER_DATE, [], { durationMinutes: 30 }).map((s) => s.time);
  const longService = computeAvailableSlots(practice, SUMMER_DATE, [], { durationMinutes: 90 }).map((s) => s.time);
  assert.ok(shortService.includes('4:00 PM'), 'a 30-minute service at 4:00 PM ends well before 5 PM close');
  assert.ok(!longService.includes('4:00 PM'), 'a 90-minute service at 4:00 PM would run until 5:30 PM, past close');
  assert.ok(longService.includes('3:30 PM'), 'a 90-minute service at 3:30 PM ends exactly at 5:00 PM close, which fits');
});

test('a closed day has no available slots regardless of busy intervals', () => {
  assert.deepEqual(computeAvailableSlots(practice, CLOSED_DAY, [], { durationMinutes: 30 }), []);
});

test('computeSlotWindowUtc returns null for an unparseable time label instead of throwing', () => {
  assert.equal(computeSlotWindowUtc(practice, SUMMER_DATE, 'not a time', 30), null);
});

test('intervalsOverlap / isSlotFree: standard interval overlap semantics', () => {
  const a = new Date('2030-06-19T14:00:00.000Z');
  const b = new Date('2030-06-19T14:30:00.000Z');
  const c = new Date('2030-06-19T15:00:00.000Z');
  assert.equal(intervalsOverlap(a, b, b, c), false, 'back-to-back intervals (touching at the boundary) do not overlap');
  assert.equal(intervalsOverlap(a, c, b, c), true, 'a genuinely overlapping interval is detected');
  assert.equal(isSlotFree(a, b, [{ start: b, end: c }]), true);
  assert.equal(isSlotFree(a, c, [{ start: b, end: c }]), false);
});

test('isSlotFree: ignoreIntervals lets a slot exclude its own current calendar block (needed for rescheduling)', () => {
  const ownStart = new Date('2030-06-19T14:00:00.000Z');
  const ownEnd = new Date('2030-06-19T14:45:00.000Z');
  // Requested new window overlaps the appointment's OWN existing block.
  const newStart = new Date('2030-06-19T14:15:00.000Z');
  const newEnd = new Date('2030-06-19T15:00:00.000Z');
  const busy = [{ start: ownStart, end: ownEnd }];
  assert.equal(isSlotFree(newStart, newEnd, busy), false, 'without ignoring, the own block looks like a conflict');
  assert.equal(
    isSlotFree(newStart, newEnd, busy, [{ start: ownStart, end: ownEnd }]),
    true,
    'ignoring the own block correctly treats it as free'
  );
});
