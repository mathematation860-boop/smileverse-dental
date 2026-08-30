/**
 * Pure merge of a practice's static base config (config/practices/*.js)
 * with its admin-editable overrides (models/PracticeSettings.js).
 *
 * Zero I/O — same "pure logic, fully unit-testable" pattern as
 * googleCalendarLogic.js from Phase 2. config/practiceRepository.js is
 * the only caller, and it's the one that actually reads the override
 * document from the database.
 *
 * Deliberately a WHITELIST of overridable fields, not a deep object
 * merge of everything: `demoMode`, `integrations`, `compliance`,
 * `practiceId`, and `emergencyPolicy.emergencyServiceId` always come
 * from the static base config no matter what an override document
 * contains. Those are safety/isolation/architecture invariants (Phase 2
 * demo-mode gating, the emergency-routing target, which practice this
 * even is) that a practice admin must never be able to change from a
 * settings form — see requirement #11 ("the deterministic emergency
 * classifier must remain authoritative") and #15 ("do not accidentally
 * connect the demo practice to a real calendar").
 */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Merges `overrides` (a plain object, or null/undefined) onto `basePractice`. Returns a NEW object; never mutates either input. */
function mergePracticeConfig(basePractice, overrides) {
  const merged = { ...basePractice };
  if (!overrides) return merged;

  const simpleFields = ['name', 'tagline', 'phone', 'email', 'address', 'website', 'timezone'];
  for (const field of simpleFields) {
    if (isNonEmptyString(overrides[field])) merged[field] = overrides[field];
  }

  if (overrides.hours && typeof overrides.hours === 'object') {
    merged.hours = { ...basePractice.hours, ...overrides.hours };
  }

  if (Array.isArray(overrides.services) && overrides.services.length > 0) {
    merged.services = overrides.services;
  }

  if (overrides.insurance && typeof overrides.insurance === 'object') {
    merged.insurance = { ...basePractice.insurance, ...overrides.insurance };
  }

  if (Array.isArray(overrides.faqs)) {
    merged.faqs = overrides.faqs;
  }

  if (overrides.policies && typeof overrides.policies === 'object') {
    merged.cancellationPolicy = {
      ...basePractice.cancellationPolicy,
      ...(isNonEmptyString(overrides.policies.cancellationSummary) ? { summary: overrides.policies.cancellationSummary } : {}),
    };
    merged.emergencyPolicy = {
      ...basePractice.emergencyPolicy,
      ...(isNonEmptyString(overrides.policies.emergencySummary) ? { summary: overrides.policies.emergencySummary } : {}),
      // NEVER overridable — see file header.
      emergencyServiceId: basePractice.emergencyPolicy?.emergencyServiceId,
    };
  }

  // Practice-specific AI instructions (requirement #11) — additive context
  // only, surfaced by config/promptBuilder.js alongside (never instead of)
  // the deterministic emergency/safety rules. Not present on the base
  // config object at all, so it always comes from the override if set.
  merged.aiConfig = { customInstructions: isNonEmptyString(overrides.aiConfig?.customInstructions) ? overrides.aiConfig.customInstructions : '' };

  // Invariants: always the base config's values, regardless of overrides.
  merged.practiceId = basePractice.practiceId;
  merged.demoMode = basePractice.demoMode;
  merged.integrations = basePractice.integrations;
  merged.compliance = basePractice.compliance;

  return merged;
}

module.exports = { mergePracticeConfig };
