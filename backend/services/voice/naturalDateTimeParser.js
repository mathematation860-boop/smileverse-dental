/**
 * Deterministic, dependency-free natural-language date/time parsing for
 * the voice channel.
 *
 * Why this exists at all: the web booking flow has a date picker and a
 * clickable list of available time slots, so it never needs to understand
 * free text like "Friday afternoon" — a phone caller has no picker, so
 * something has to turn "kal", "Friday", "afternoon", "2pm" into the same
 * YYYY-MM-DD / "10:00 AM"-style values services/availabilityService.js
 * already works with. This is intentionally conservative: on anything
 * ambiguous it returns null/multiple candidates rather than guessing, so
 * services/voice/voiceBookingFlow.js can always fall back to asking the
 * caller to choose from real, currently-available options — never
 * fabricating a date or time that wasn't actually confirmed as open.
 *
 * Supports English, Urdu-script, and Roman Urdu, per Phase 4 spec §16.
 */

const { todayInTimezone } = require('../../utils/timezone');

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// Roman Urdu day names are inconsistently transliterated in practice, so
// only the handful of unambiguous cases are matched; anything else falls
// through to the plain English weekday names above (also commonly used by
// Roman Urdu speakers mid-sentence, e.g. "Friday ko koi slot hai?").
const ROMAN_URDU_WEEKDAYS = {
  itwar: 0, atwar: 0,
  peer: 1, pir: 1,
  mangal: 2,
  budh: 3, buddh: 3,
  jumeraat: 4, jumerat: 4,
  jumma: 5, jumaa: 5,
  hafta: 6, saneechar: 6,
};

// Urdu-script day names, for a caller speaking Urdu rather than Roman Urdu
// (Phase 4 spec §16 requires both). Matched with plain substring checks,
// like ROMAN_URDU_WEEKDAYS above, never `\b`-wrapped regex — JavaScript's
// `\b` word-boundary is defined only in terms of ASCII `\w`, so it does not
// behave correctly around Arabic-script characters.
const URDU_SCRIPT_WEEKDAYS = {
  'اتوار': 0,
  'پیر': 1,
  'منگل': 2,
  'بدھ': 3,
  'جمعرات': 4,
  'جمعہ': 5,
  'ہفتہ': 6,
};

function addDaysUtc(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function dateToStr(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * @param {string} text - raw caller utterance
 * @param {string} timezone - practice IANA timezone (dates are relative to "today" in the PRACTICE's timezone, never the server's)
 * @returns {string|null} 'YYYY-MM-DD', or null if nothing date-like was recognized
 */
function parseDate(text, timezone) {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;

  // Already an explicit date.
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const todayStr = todayInTimezone(timezone);
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(Date.UTC(y, m - 1, d));

  if (/\btoday\b|\baaj\b/.test(t) || t.includes('آج')) return dateToStr(today);
  if (/\bday after tomorrow\b|\bparso\b/.test(t) || t.includes('پرسوں')) return dateToStr(addDaysUtc(today, 2));
  if (/\btomorrow\b|\bkal\b/.test(t) || t.includes('کل')) return dateToStr(addDaysUtc(today, 1));

  const explicitlyNext = /\bnext\b|\bagle\b|\baglay\b/.test(t) || t.includes('اگلے') || t.includes('اگلا');

  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (t.includes(WEEKDAYS[i])) return dateToStr(resolveWeekday(today, i, explicitlyNext));
  }
  for (const [word, weekdayIndex] of Object.entries(ROMAN_URDU_WEEKDAYS)) {
    if (t.includes(word)) return dateToStr(resolveWeekday(today, weekdayIndex, explicitlyNext));
  }
  for (const [word, weekdayIndex] of Object.entries(URDU_SCRIPT_WEEKDAYS)) {
    if (t.includes(word)) return dateToStr(resolveWeekday(today, weekdayIndex, explicitlyNext));
  }

  return null;
}

function resolveWeekday(today, targetWeekday, explicitlyNext) {
  let delta = (targetWeekday - today.getUTCDay() + 7) % 7;
  if (delta === 0 && explicitlyNext) delta = 7; // "next Friday" said on a Friday means a week from now, not today
  return addDaysUtc(today, delta);
}

const TIME_OF_DAY_WINDOWS = [
  { pattern: /\bmorning\b|\bsubah\b|\bsuba\b/, urduWords: ['صبح'], startMinutes: 0, endMinutes: 12 * 60 },
  { pattern: /\bafternoon\b|\bdopeher\b|\bdopehar\b/, urduWords: ['دوپہر'], startMinutes: 12 * 60, endMinutes: 17 * 60 },
  { pattern: /\bevening\b|\bshaam\b/, urduWords: ['شام'], startMinutes: 17 * 60, endMinutes: 21 * 60 },
];

/**
 * Returns { startMinutes, endMinutes } for a vague time-of-day phrase
 * ("afternoon"/"dopeher"/"دوپہر"), or null. Urdu-script words are matched
 * with a plain substring check (`urduWords`), never the `pattern` regex —
 * see the URDU_SCRIPT_WEEKDAYS comment above for why `\b` is unsafe there.
 */
function parseTimeOfDayWindow(text) {
  const raw = text || '';
  const t = raw.toLowerCase();
  for (const w of TIME_OF_DAY_WINDOWS) {
    if (w.pattern.test(t) || w.urduWords.some((word) => raw.includes(word))) {
      return { startMinutes: w.startMinutes, endMinutes: w.endMinutes };
    }
  }
  return null;
}

/** Returns minutes-since-midnight for an explicit time mention ("2pm", "2:30 pm", "10 in the morning"), or null if none/ambiguous (no am/pm and not clearly a 24h-style hour). */
function parseExplicitTimeMinutes(text) {
  const t = (text || '').toLowerCase();
  const match = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const ampm = match[3];
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (ampm === 'am') hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return hour * 60 + minute;
}

/**
 * Matches a caller's time-related utterance against a list of ACTUALLY
 * available slots (from availabilityService.getAvailableSlots — never
 * invented here). Returns:
 *   { matched: {time, minutes} }              - exactly one slot resolved
 *   { candidates: [{time, minutes}, ...] }     - multiple plausible slots (vague window, or none specified) — caller must be asked to choose
 *   { candidates: [] }                          - nothing available matches at all
 */
function resolveRequestedSlot(text, availableSlots) {
  const explicitMinutes = parseExplicitTimeMinutes(text);
  if (explicitMinutes !== null) {
    const exact = availableSlots.find((s) => s.minutes === explicitMinutes);
    if (exact) return { matched: exact };
    return { candidates: [] }; // that specific time isn't open — never substitute a different time silently
  }

  const window = parseTimeOfDayWindow(text);
  if (window) {
    const inWindow = availableSlots.filter((s) => s.minutes >= window.startMinutes && s.minutes < window.endMinutes);
    if (inWindow.length === 1) return { matched: inWindow[0] };
    return { candidates: inWindow.slice(0, 3) };
  }

  return { candidates: availableSlots.slice(0, 3) };
}

module.exports = { parseDate, parseTimeOfDayWindow, parseExplicitTimeMinutes, resolveRequestedSlot };
