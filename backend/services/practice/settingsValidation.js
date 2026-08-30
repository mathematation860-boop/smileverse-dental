/**
 * Validates + sanitizes a Practice Settings update before it's ever
 * persisted (requirement #10: "Validate all changes. Do not allow
 * arbitrary code or unsafe HTML."). Pure function, no I/O, fully
 * unit-testable — same pattern as googleCalendarLogic.js.
 *
 * Approach: strip ALL HTML tags from every free-text field (this is a
 * dental practice's contact info/FAQ copy, not a rich-text CMS — there is
 * no legitimate reason for an admin to need HTML here at all, so
 * stripping outright is simpler and safer than trying to allow a "safe"
 * subset), reject obviously-malicious payloads outright, and bound
 * every numeric/enum field to a sane range.
 */

const MAX_LENGTHS = {
  name: 200,
  tagline: 200,
  phone: 40,
  email: 200,
  address: 300,
  website: 300,
  timezone: 100,
  freeText: 2000, // FAQ answers, policy summaries, AI custom instructions
};

function stripHtml(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/<[^>]*>/g, '').trim();
}

function isValidTimezone(tz) {
  if (!isNonEmptyString(tz)) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch (err) {
    return false;
  }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidTimeString(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
}

function containsSuspiciousPayload(value) {
  if (typeof value !== 'string') return false;
  return /<script|javascript:|on\w+\s*=/i.test(value);
}

/**
 * Validates a raw settings patch (as sent by the admin dashboard).
 * Returns { valid: true, sanitized } or { valid: false, errors: string[] }.
 */
function validateSettingsPatch(patch) {
  const errors = [];
  if (!patch || typeof patch !== 'object') {
    return { valid: false, errors: ['Request body must be an object.'] };
  }

  const sanitized = {};

  for (const field of ['name', 'tagline', 'phone', 'email', 'address', 'website']) {
    if (patch[field] !== undefined) {
      if (containsSuspiciousPayload(patch[field])) {
        errors.push(`Field "${field}" contains disallowed content.`);
        continue;
      }
      const clean = stripHtml(patch[field]);
      if (clean.length > MAX_LENGTHS[field]) {
        errors.push(`Field "${field}" is too long (max ${MAX_LENGTHS[field]} characters).`);
        continue;
      }
      sanitized[field] = clean;
    }
  }

  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) {
      errors.push('timezone must be a valid IANA timezone name (e.g. "America/New_York").');
    } else {
      sanitized.timezone = patch.timezone;
    }
  }

  if (patch.hours !== undefined) {
    const h = patch.hours || {};
    const hours = {};
    if (h.openTime !== undefined) {
      if (!isValidTimeString(h.openTime)) errors.push('hours.openTime must be in HH:MM 24-hour format.');
      else hours.openTime = h.openTime;
    }
    if (h.closeTime !== undefined) {
      if (!isValidTimeString(h.closeTime)) errors.push('hours.closeTime must be in HH:MM 24-hour format.');
      else hours.closeTime = h.closeTime;
    }
    if (h.openTime && h.closeTime && isValidTimeString(h.openTime) && isValidTimeString(h.closeTime) && h.openTime >= h.closeTime) {
      errors.push('hours.openTime must be earlier than hours.closeTime.');
    }
    if (h.slotMinutes !== undefined) {
      const n = Number(h.slotMinutes);
      if (!Number.isInteger(n) || n < 5 || n > 240) errors.push('hours.slotMinutes must be an integer between 5 and 240.');
      else hours.slotMinutes = n;
    }
    if (h.openDays !== undefined) {
      if (!Array.isArray(h.openDays) || !h.openDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
        errors.push('hours.openDays must be an array of integers 0-6 (Sunday-Saturday).');
      } else {
        hours.openDays = [...new Set(h.openDays)].sort();
      }
    }
    if (h.display !== undefined) hours.display = stripHtml(h.display).slice(0, 200);
    sanitized.hours = hours;
  }

  if (patch.services !== undefined) {
    if (!Array.isArray(patch.services)) {
      errors.push('services must be an array.');
    } else if (patch.services.length > 100) {
      errors.push('services list is too long (max 100).');
    } else {
      sanitized.services = patch.services.map((s, i) => {
        if (!isNonEmptyString(s?.id) || !isNonEmptyString(s?.name)) {
          errors.push(`services[${i}] requires a non-empty id and name.`);
          return null;
        }
        const price = s.price === null || s.price === undefined ? null : Number(s.price);
        const duration = Number(s.duration);
        if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
          errors.push(`services[${i}].price must be null or a number between 0 and 100000.`);
        }
        if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
          errors.push(`services[${i}].duration must be an integer number of minutes between 5 and 480.`);
        }
        return {
          id: stripHtml(s.id).slice(0, 60),
          name: stripHtml(s.name).slice(0, 100),
          price,
          duration,
          description: isNonEmptyString(s.description) ? stripHtml(s.description).slice(0, MAX_LENGTHS.freeText) : '',
          eligiblePatientTypes: Array.isArray(s.eligiblePatientTypes) ? s.eligiblePatientTypes.filter((t) => t === 'new' || t === 'existing') : ['new', 'existing'],
        };
      }).filter(Boolean);
    }
  }

  if (patch.insurance !== undefined) {
    const ins = patch.insurance || {};
    const insurance = {};
    if (ins.acceptedProviders !== undefined) {
      if (!Array.isArray(ins.acceptedProviders) || !ins.acceptedProviders.every(isNonEmptyString)) {
        errors.push('insurance.acceptedProviders must be an array of non-empty strings.');
      } else {
        insurance.acceptedProviders = ins.acceptedProviders.map((p) => stripHtml(p).slice(0, 100)).slice(0, 100);
      }
    }
    if (ins.notes !== undefined) {
      if (containsSuspiciousPayload(ins.notes)) errors.push('insurance.notes contains disallowed content.');
      else insurance.notes = stripHtml(ins.notes).slice(0, MAX_LENGTHS.freeText);
    }
    sanitized.insurance = insurance;
  }

  if (patch.faqs !== undefined) {
    if (!Array.isArray(patch.faqs)) {
      errors.push('faqs must be an array of categories.');
    } else if (patch.faqs.length > 50) {
      errors.push('too many FAQ categories (max 50).');
    } else {
      sanitized.faqs = patch.faqs.map((cat, i) => {
        if (!isNonEmptyString(cat?.id) || !isNonEmptyString(cat?.label)) {
          errors.push(`faqs[${i}] requires a non-empty id and label.`);
          return null;
        }
        const items = Array.isArray(cat.items) ? cat.items : [];
        return {
          id: stripHtml(cat.id).slice(0, 60),
          label: stripHtml(cat.label).slice(0, 100),
          items: items.slice(0, 50).map((it) => ({
            id: isNonEmptyString(it?.id) ? stripHtml(it.id).slice(0, 60) : `faq_${Math.random().toString(36).slice(2, 8)}`,
            question: stripHtml(it?.question || '').slice(0, 300),
            answer: stripHtml(it?.answer || '').slice(0, MAX_LENGTHS.freeText),
          })),
        };
      }).filter(Boolean);
    }
  }

  if (patch.policies !== undefined) {
    const p = patch.policies || {};
    const policies = {};
    if (p.cancellationSummary !== undefined) {
      if (containsSuspiciousPayload(p.cancellationSummary)) errors.push('policies.cancellationSummary contains disallowed content.');
      else policies.cancellationSummary = stripHtml(p.cancellationSummary).slice(0, MAX_LENGTHS.freeText);
    }
    if (p.emergencySummary !== undefined) {
      if (containsSuspiciousPayload(p.emergencySummary)) errors.push('policies.emergencySummary contains disallowed content.');
      else policies.emergencySummary = stripHtml(p.emergencySummary).slice(0, MAX_LENGTHS.freeText);
    }
    sanitized.policies = policies;
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, sanitized };
}

/** AI config is validated separately (requirement #11) — deliberately just one free-text field, never anything that could look like a rule/flag/toggle. */
function validateAiConfigPatch(patch) {
  if (!patch || typeof patch !== 'object') return { valid: false, errors: ['Request body must be an object.'] };
  const raw = patch.customInstructions;
  if (raw !== undefined && typeof raw !== 'string') {
    return { valid: false, errors: ['customInstructions must be a string.'] };
  }
  if (containsSuspiciousPayload(raw || '')) {
    return { valid: false, errors: ['customInstructions contains disallowed content.'] };
  }
  const clean = stripHtml(raw || '').slice(0, MAX_LENGTHS.freeText);
  return { valid: true, sanitized: { customInstructions: clean } };
}

/** Phase 5: validates a notification-settings patch (spec §9/§19 — channel toggles + reminder lead time only; never a phone/email destination, which stays a base-config-only invariant — see practiceMerge.js). */
function validateNotificationSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return { valid: false, errors: ['Request body must be an object.'] };
  const errors = [];
  const sanitized = {};

  if (patch.smsEnabled !== undefined) {
    if (typeof patch.smsEnabled !== 'boolean') errors.push('smsEnabled must be a boolean.');
    else sanitized.smsEnabled = patch.smsEnabled;
  }
  if (patch.emailEnabled !== undefined) {
    if (typeof patch.emailEnabled !== 'boolean') errors.push('emailEnabled must be a boolean.');
    else sanitized.emailEnabled = patch.emailEnabled;
  }
  if (patch.reminderOffsetsHours !== undefined) {
    const arr = patch.reminderOffsetsHours;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 5 || !arr.every((h) => Number.isFinite(h) && h > 0 && h <= 336)) {
      errors.push('reminderOffsetsHours must be a non-empty array (max 5) of positive numbers of hours, each at most 336 (14 days).');
    } else {
      sanitized.reminderOffsetsHours = [...new Set(arr)].sort((a, b) => b - a);
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, sanitized };
}

/** Phase 6: validates a PMS mapping-settings patch (spec §11/§12/§13) — service/provider/operatory ID mappings ONLY. Never accepts apiBaseUrl, credentials, or clinicNum, which stay base-config/env-only invariants (see practiceMerge.js) — this validator's schema simply never reads them, so passing one through is silently ignored, never persisted. */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isValidExternalId(v) {
  return typeof v === 'string' ? v.trim().length > 0 && v.length <= 60 : typeof v === 'number' && Number.isFinite(v);
}

function sanitizeMappingObject(raw, idField, errors, label) {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw)) {
    errors.push(`${label} must be an object.`);
    return undefined;
  }
  const keys = Object.keys(raw);
  if (keys.length > 100) {
    errors.push(`${label} has too many entries (max 100).`);
    return undefined;
  }
  const sanitized = {};
  for (const key of keys) {
    const entry = raw[key];
    if (!isPlainObject(entry) || entry[idField] === undefined) {
      errors.push(`${label}.${key} must be an object with a "${idField}" field.`);
      continue;
    }
    if (!isValidExternalId(entry[idField])) {
      errors.push(`${label}.${key}.${idField} must be a non-empty string or number.`);
      continue;
    }
    sanitized[stripHtml(key).slice(0, 60)] = { [idField]: String(entry[idField]).slice(0, 60) };
  }
  return sanitized;
}

function validatePmsSettingsPatch(patch) {
  if (!patch || typeof patch !== 'object') return { valid: false, errors: ['Request body must be an object.'] };
  const errors = [];
  const sanitized = {};

  const serviceMappings = sanitizeMappingObject(patch.serviceMappings, 'openDentalAppointmentTypeNum', errors, 'serviceMappings');
  if (serviceMappings !== undefined) sanitized.serviceMappings = serviceMappings;

  const providerMappings = sanitizeMappingObject(patch.providerMappings, 'openDentalProvNum', errors, 'providerMappings');
  if (providerMappings !== undefined) sanitized.providerMappings = providerMappings;

  const operatoryMappings = sanitizeMappingObject(patch.operatoryMappings, 'openDentalOpNum', errors, 'operatoryMappings');
  if (operatoryMappings !== undefined) sanitized.operatoryMappings = operatoryMappings;

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, sanitized };
}

module.exports = { validateSettingsPatch, validateAiConfigPatch, validateNotificationSettingsPatch, validatePmsSettingsPatch, stripHtml, isValidTimezone, MAX_LENGTHS };
