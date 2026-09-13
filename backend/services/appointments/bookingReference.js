/**
 * Booking references — the patient's proof that an appointment is theirs.
 *
 * Before this, /api/appointments/search returned every appointment
 * matching a phone number, and PATCH/DELETE /api/appointments/:id acted
 * on any id handed to them. Both are public, unauthenticated endpoints,
 * so a phone number (or an id) was enough to read someone's appointment
 * details or cancel their visit. A phone number is not a secret: it is
 * printed on the patient's own paperwork, shared with staff, and
 * guessable in bulk.
 *
 * A reference is a high-entropy value generated server-side at booking
 * time and returned only in the booking response, so only the person who
 * made the booking (or someone the clinic gave it to) holds it. Lookup
 * and change now require phone AND reference together: the phone selects
 * the record, the reference proves possession.
 *
 * Deliberate limits, stated rather than papered over:
 *   - This is a bearer secret. Anyone who obtains the reference can act
 *     on the appointment. That is the same trust model as an airline
 *     confirmation code, and is appropriate for self-service change and
 *     cancel — it is NOT a substitute for the authenticated admin path.
 *   - It is stored in plaintext so staff can read it back to a patient
 *     who lost it. Compromise of the database therefore exposes it, but
 *     that database already holds the appointment itself.
 *
 * Alphabet excludes 0/O, 1/I/L and U: references get read down a phone
 * line and typed back by hand.
 */

const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LENGTH = 10;

/**
 * A fresh reference, e.g. 'K7QF2M9XBT'. Uses rejection sampling over
 * random bytes so every character is uniformly distributed — a plain
 * `byte % 30` would make the first two letters of the alphabet slightly
 * more likely, which needlessly shaves entropy off a guessing target.
 */
function generateBookingReference(randomBytes = crypto.randomBytes) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < LENGTH) {
    const bytes = randomBytes(LENGTH);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === LENGTH) break;
    }
  }
  return out;
}

/**
 * What the patient typed, in the form we stored: uppercased with spaces
 * and dashes dropped, so 'k7qf-2m9x-bt' matches 'K7QF2M9XBT'. Returns
 * null for anything that isn't a plausible reference, so callers can
 * reject bad input before touching the database.
 */
function normalizeBookingReference(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== LENGTH) return null;
  for (const char of cleaned) {
    if (!ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

/**
 * Compares a supplied reference against the stored one without leaking
 * how much of it was correct through response timing. Both values are
 * hashed first so timingSafeEqual always gets equal-length buffers —
 * comparing raw strings of different lengths throws, and the length
 * itself would be the leak.
 */
function referenceMatches(supplied, stored) {
  if (typeof supplied !== 'string' || typeof stored !== 'string') return false;
  if (!supplied || !stored) return false;
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(stored).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  generateBookingReference,
  normalizeBookingReference,
  referenceMatches,
  BOOKING_REFERENCE_LENGTH: LENGTH,
  BOOKING_REFERENCE_ALPHABET: ALPHABET,
};
