const { test } = require('node:test');
const assert = require('node:assert/strict');
const availabilityService = require('../services/availabilityService');

// Small fixed practice fixture, independent of the real smileverse-dental
// config, so these tests don't break if the demo practice's hours ever
// change. Open Mon-Fri, 9:00-10:00, 30-minute slots -> exactly two
// possible slots per open day: 9:00 AM and 9:30 AM.
const practice = {
  practiceId: 'test-practice',
  timezone: 'America/New_York',
  hours: {
    openDays: [1, 2, 3, 4, 5],
    openTime: '09:00',
    closeTime: '10:00',
    slotMinutes: 30,
  },
};

// Fixed, far-future dates (verified weekday, not "today" relative to this
// project's environment) so these tests never depend on the wall clock:
const MONDAY = '2027-03-01'; // open day
const SATURDAY = '2027-03-06'; // closed day
const SUNDAY = '2027-03-07'; // closed day

test('weekdayOfDateString computes weekday from the calendar date itself (not timezone-shifted)', () => {
  assert.equal(availabilityService.weekdayOfDateString(MONDAY), 1);
  assert.equal(availabilityService.weekdayOfDateString(SATURDAY), 6);
  assert.equal(availabilityService.weekdayOfDateString(SUNDAY), 0);
});

test('isOpenDay is true only on the practice configured open weekdays', () => {
  assert.equal(availabilityService.isOpenDay(practice, MONDAY), true);
  assert.equal(availabilityService.isOpenDay(practice, SATURDAY), false);
  assert.equal(availabilityService.isOpenDay(practice, SUNDAY), false);
});

test('isOpenDay rejects malformed or missing date strings instead of throwing', () => {
  assert.equal(availabilityService.isOpenDay(practice, 'not-a-date'), false);
  assert.equal(availabilityService.isOpenDay(practice, undefined), false);
});

test('getAvailableSlots returns nothing on a closed day', () => {
  const slots = availabilityService.getAvailableSlots(practice, SATURDAY);
  assert.deepEqual(slots, []);
});

test('getAvailableSlots never returns a slot outside configured business hours', () => {
  const slots = availabilityService.getAvailableSlots(practice, MONDAY);
  const allowedLabels = new Set(['9:00 AM', '9:30 AM']);
  for (const slot of slots) {
    assert.ok(allowedLabels.has(slot.time), `unexpected slot label: ${slot.time}`);
  }
});

test('getAvailableSlots excludes real bookedTimes even if not in the mock-taken set', () => {
  const slots = availabilityService.getAvailableSlots(practice, MONDAY, {
    bookedTimes: ['9:00 AM', '9:30 AM'],
  });
  assert.deepEqual(slots, []);
});

test('getAvailableSlots is deterministic across repeated calls for the same date', () => {
  const first = availabilityService.getAvailableSlots(practice, MONDAY);
  const second = availabilityService.getAvailableSlots(practice, MONDAY);
  assert.deepEqual(first, second);
});

test('nextOpenDates only returns dates the practice is actually open on', () => {
  const dates = availabilityService.nextOpenDates(practice, 5);
  assert.equal(dates.length, 5);
  for (const dateStr of dates) {
    assert.equal(availabilityService.isOpenDay(practice, dateStr), true);
  }
});
