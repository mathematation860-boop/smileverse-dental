/**
 * Destination validation + masking for notifications (Phase 5 spec §10,
 * §18). Pure, zero-I/O functions — fully unit-testable, same pattern as
 * services/practice/settingsValidation.js.
 *
 * "Never send to an unverified/invalid destination" (spec §10) means:
 * reject anything that isn't at least a plausibly well-formed
 * email/phone BEFORE ever calling a provider — a malformed destination is
 * a permanent failure, not something worth even attempting or retrying.
 */

// Deliberately conservative (not a full RFC 5322 parser) — good enough to
// reject obvious typos/garbage without rejecting real addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.trim().length > 0 && email.length <= 254 && EMAIL_PATTERN.test(email.trim());
}

/** Accepts E.164-ish input (with or without a leading '+', spaces/dashes/parens) — same forgiving-format philosophy as config/practiceRepository.js's normalizePhoneNumber, but validates plausibility (7-15 digits per ITU E.164) rather than just stripping punctuation. */
function isValidPhone(phone) {
  if (typeof phone !== 'string' && typeof phone !== 'number') return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

/** Normalizes to E.164-ish digits-with-leading-plus for a provider call. Assumes US/Canada (10 digits, no country code) if no country code was given — same convention the rest of this demo/prototype codebase already uses for US phone numbers; a real multi-country deployment would need real E.164 input from patients or explicit per-practice country config. */
function normalizePhoneForSend(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (String(phone).trim().startsWith('+')) return `+${digits}`;
  return `+${digits}`;
}

/** Masks an email for storage/display in notification history (spec §18: "destination masked where appropriate") — never the full address. */
function maskEmail(email) {
  if (!isValidEmail(email)) return null;
  const [user, domain] = email.trim().split('@');
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}

/** Masks a phone number for storage/display — keeps only the last 4 digits. */
function maskPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `***${digits.slice(-4)}`;
}

module.exports = { isValidEmail, isValidPhone, normalizePhoneForSend, maskEmail, maskPhone };
