const test = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../services/voice/naturalDateTimeParser');

const TZ = 'America/New_York';

test('ENGLISH: "tomorrow" and a plain weekday name resolve to real calendar dates', () => {
  assert.match(parser.parseDate('tomorrow', TZ), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(parser.parseDate('Friday', TZ), /^\d{4}-\d{2}-\d{2}$/);
});

test('ROMAN URDU: "kal" (tomorrow) and a Roman Urdu weekday resolve the same way as their English equivalents', () => {
  const englishTomorrow = parser.parseDate('tomorrow', TZ);
  const romanTomorrow = parser.parseDate('kal', TZ);
  assert.equal(romanTomorrow, englishTomorrow);

  const englishFriday = parser.parseDate('Friday', TZ);
  const romanFriday = parser.parseDate('jumma', TZ);
  assert.equal(romanFriday, englishFriday);
});

test('URDU SCRIPT: "کل" (tomorrow) and an Urdu-script weekday resolve the same way as their English equivalents', () => {
  const englishTomorrow = parser.parseDate('tomorrow', TZ);
  const urduTomorrow = parser.parseDate('کل آ سکتے ہیں؟', TZ);
  assert.equal(urduTomorrow, englishTomorrow);

  const englishFriday = parser.parseDate('Friday', TZ);
  const urduFriday = parser.parseDate('جمعہ کو کوئی وقت ہے؟', TZ);
  assert.equal(urduFriday, englishFriday);
});

test('MIXED / CODE-SWITCHED: a Roman Urdu sentence using the English weekday name still resolves ("Friday ko koi slot hai?" — Phase 4 spec §16 example)', () => {
  const englishFriday = parser.parseDate('Friday', TZ);
  assert.equal(parser.parseDate('Friday ko koi slot hai?', TZ), englishFriday);
});

test('AMBIGUOUS INPUT: nothing date-like returns null rather than guessing', () => {
  assert.equal(parser.parseDate('sometime soon I guess', TZ), null);
  assert.equal(parser.parseDate('', TZ), null);
});

test('TIME OF DAY WINDOWS: English, Roman Urdu, and Urdu-script phrases for the same time of day map to the same window', () => {
  const english = parser.parseTimeOfDayWindow('sometime in the afternoon');
  const roman = parser.parseTimeOfDayWindow('dopeher mein');
  const urdu = parser.parseTimeOfDayWindow('دوپہر میں');
  assert.deepEqual(roman, english);
  assert.deepEqual(urdu, english);
});

test('EXPLICIT TIME PARSING: "2pm" and "2:30 pm" resolve to exact minutes-since-midnight; ambiguous/24h-style input does not', () => {
  assert.equal(parser.parseExplicitTimeMinutes('2pm'), 14 * 60);
  assert.equal(parser.parseExplicitTimeMinutes('2:30 pm'), 14 * 60 + 30);
  assert.equal(parser.parseExplicitTimeMinutes('14:00'), null, 'a bare 24h-style time with no am/pm must not be guessed');
});

test('resolveRequestedSlot: an explicit time that IS actually available matches exactly one real slot', () => {
  const slots = [{ time: '10:00 AM', minutes: 600 }, { time: '2:00 PM', minutes: 840 }];
  const result = parser.resolveRequestedSlot('2pm', slots);
  assert.deepEqual(result.matched, { time: '2:00 PM', minutes: 840 });
});

test('resolveRequestedSlot: an explicit time that is NOT available never substitutes a different real slot silently', () => {
  const slots = [{ time: '10:00 AM', minutes: 600 }];
  const result = parser.resolveRequestedSlot('2pm', slots);
  assert.equal(result.matched, undefined);
  assert.deepEqual(result.candidates, []);
});

test('resolveRequestedSlot: a vague time-of-day phrase with multiple real matches asks the caller to choose, never guesses one', () => {
  const slots = [{ time: '9:00 AM', minutes: 540 }, { time: '10:00 AM', minutes: 600 }, { time: '11:00 AM', minutes: 660 }];
  const result = parser.resolveRequestedSlot('sometime in the morning', slots);
  assert.equal(result.matched, undefined);
  assert.equal(result.candidates.length, 3);
});

test('resolveRequestedSlot: no time mentioned at all offers real available slots as candidates rather than failing', () => {
  const slots = [{ time: '9:00 AM', minutes: 540 }];
  const result = parser.resolveRequestedSlot('whenever works', slots);
  assert.deepEqual(result.candidates, slots);
});
