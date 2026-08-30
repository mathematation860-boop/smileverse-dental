/**
 * Deterministic insurance lookup — never AI-generated, so coverage is
 * never invented. Matches against practiceConfig's configured provider
 * list (see backend/config/insurance.js) with light fuzzy matching.
 */

const insuranceConfig = require('../config/insurance');

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string} providerName - free text the patient typed
 * @returns {{ status: 'accepted'|'unknown', provider: string|null, message: string }}
 */
function checkProvider(providerName) {
  const normalizedInput = normalize(providerName);
  if (!normalizedInput) {
    return {
      status: 'unknown',
      provider: null,
      message: "I don't have enough information to confirm that. I can connect you with our front desk team.",
    };
  }

  const match = insuranceConfig.acceptedProviders.find((p) => {
    const normalizedProvider = normalize(p);
    return normalizedProvider.includes(normalizedInput) || normalizedInput.includes(normalizedProvider);
  });

  if (match) {
    return {
      status: 'accepted',
      provider: match,
      message: `Yes, we accept ${match}. ${insuranceConfig.notes}`,
    };
  }

  return {
    status: 'unknown',
    provider: null,
    message: "I don't have enough information to confirm that. I can connect you with our front desk team.",
  };
}

function listAccepted() {
  return {
    acceptedProviders: insuranceConfig.acceptedProviders,
    notes: insuranceConfig.notes,
    notesUr: insuranceConfig.notesUr,
  };
}

module.exports = { checkProvider, listAccepted };
