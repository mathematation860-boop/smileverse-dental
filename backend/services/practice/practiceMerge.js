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
 * `practiceId`, `voice`, and `emergencyPolicy.emergencyServiceId` always
 * come from the static base config no matter what an override document
 * contains. Those are safety/isolation/architecture invariants (Phase 2
 * demo-mode gating, the emergency-routing target, which practice this
 * even is; Phase 4 adds which phone number routes to this practice) that
 * a practice admin must never be able to change from a settings form —
 * see requirement #11 ("the deterministic emergency classifier must
 * remain authoritative") and #15 ("do not accidentally connect the demo
 * practice to a real calendar"). `voice.phoneNumber` follows the same
 * rule for the same reason: if an admin could edit it, one practice's
 * dashboard could silently steal another practice's incoming calls.
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

  // Phase 5: notification preferences are PARTIALLY overridable — an admin
  // may toggle channels on/off and adjust reminder lead time, but
  // `smsPhoneNumber`/`clinicAlertPhone`/`clinicAlertEmail` always come from
  // the base config (same invariant reasoning as `voice.phoneNumber`
  // above — see this file's header comment).
  const notifOverrides = overrides.notifications && typeof overrides.notifications === 'object' ? overrides.notifications : {};
  merged.notifications = {
    ...basePractice.notifications,
    ...(typeof notifOverrides.smsEnabled === 'boolean' ? { smsEnabled: notifOverrides.smsEnabled } : {}),
    ...(typeof notifOverrides.emailEnabled === 'boolean' ? { emailEnabled: notifOverrides.emailEnabled } : {}),
    ...(Array.isArray(notifOverrides.reminderOffsetsHours) && notifOverrides.reminderOffsetsHours.every((h) => Number.isFinite(h) && h > 0)
      ? { reminderOffsetsHours: notifOverrides.reminderOffsetsHours }
      : {}),
    // NEVER overridable — see file header.
    smsPhoneNumber: basePractice.notifications?.smsPhoneNumber ?? null,
    clinicAlertPhone: basePractice.notifications?.clinicAlertPhone ?? null,
    clinicAlertEmail: basePractice.notifications?.clinicAlertEmail ?? null,
  };

  // Phase 6: PMS mapping config is PARTIALLY overridable — an admin may
  // fill in service/provider/operatory mappings from the dashboard (not
  // secrets, just numeric PMS IDs), but `openDental.apiBaseUrl`/`clinicNum`
  // always come from the base config/env (same invariant reasoning as
  // `voice.phoneNumber` above — see this file's header comment).
  const pmsOverrides = overrides.pms && typeof overrides.pms === 'object' ? overrides.pms : {};
  merged.pms = {
    ...basePractice.pms,
    ...(pmsOverrides.serviceMappings && typeof pmsOverrides.serviceMappings === 'object' ? { serviceMappings: pmsOverrides.serviceMappings } : {}),
    ...(pmsOverrides.providerMappings && typeof pmsOverrides.providerMappings === 'object' ? { providerMappings: pmsOverrides.providerMappings } : {}),
    ...(pmsOverrides.operatoryMappings && typeof pmsOverrides.operatoryMappings === 'object' ? { operatoryMappings: pmsOverrides.operatoryMappings } : {}),
    // NEVER overridable — see file header.
    openDental: basePractice.pms?.openDental,
  };

  // Invariants: always the base config's values, regardless of overrides.
  merged.practiceId = basePractice.practiceId;
  merged.demoMode = basePractice.demoMode;
  merged.integrations = basePractice.integrations;
  merged.compliance = basePractice.compliance;
  merged.voice = basePractice.voice;

  return merged;
}

module.exports = { mergePracticeConfig };
