/**
 * Deterministic insurance lookup — never AI-generated, so coverage is
 * never invented. Matches against the given practice's configured
 * provider list (practice.insurance, see config/practices/*.js) with
 * light fuzzy matching.
 */

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {object} practice - resolved practice (req.practice)
 * @param {string} providerName - free text the patient typed
 * @returns {{ status: 'accepted'|'unknown', provider: string|null, message: string }}
 */
function checkProvider(practice, providerName) {
  const normalizedInput = normalize(providerName);
  if (!normalizedInput) {
    return {
      status: 'unknown',
      provider: null,
      message: "I don't have enough information to confirm that. I can connect you with our front desk team.",
    };
  }

  const match = practice.insurance.acceptedProviders.find((p) => {
    const normalizedProvider = normalize(p);
    return normalizedProvider.includes(normalizedInput) || normalizedInput.includes(normalizedProvider);
  });

  if (match) {
    return {
      status: 'accepted',
      provider: match,
      message: `Yes, we accept ${match}. ${practice.insurance.notes}`,
    };
  }

  return {
    status: 'unknown',
    provider: null,
    message: "I don't have enough information to confirm that. I can connect you with our front desk team.",
  };
}

function listAccepted(practice) {
  return {
    acceptedProviders: practice.insurance.acceptedProviders,
    notes: practice.insurance.notes,
    notesUr: practice.insurance.notesUr,
  };
}

module.exports = { checkProvider, listAccepted };
