/**
 * Small, dependency-free input validation helpers.
 *
 * Deliberately minimal — this is not a full schema-validation library
 * (adding one is a reasonable future step, noted in the README security
 * section), just enough to stop obviously-bad or abusive input before it
 * reaches a database write or an AI API call: missing required fields,
 * and unbounded string lengths that could otherwise blow up storage or
 * the per-request AI token cost.
 */

const MAX_LENGTHS = {
  name: 200,
  phone: 40,
  email: 200,
  message: 4000,
  chatMessage: 2000,
};

function requireFields(body, fields) {
  const missing = fields.filter((f) => !body || body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    return `Missing required field(s): ${missing.join(', ')}`;
  }
  return null;
}

function tooLong(value, max) {
  return typeof value === 'string' && value.length > max;
}

/** Express middleware factory: 400s if any of `fields` exceeds its known max length. */
function enforceMaxLengths(fields) {
  return (req, res, next) => {
    for (const field of fields) {
      const max = MAX_LENGTHS[field];
      if (max && tooLong(req.body?.[field], max)) {
        return res.status(400).json({ error: `Field "${field}" is too long (max ${max} characters)` });
      }
    }
    next();
  };
}

module.exports = { requireFields, tooLong, enforceMaxLengths, MAX_LENGTHS };
