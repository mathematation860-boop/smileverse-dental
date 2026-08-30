/**
 * PMS provider factory — the SAME demoMode-gated pattern as
 * services/providers/index.js (calendar), services/voice/index.js, and
 * services/notifications/index.js: `practice.demoMode !== false` ALWAYS
 * returns the mock provider, no matter what `integrations.pmsProvider`
 * says (spec §3: "When demoMode = true, the system MUST NOT call a real
 * Open Dental account"). A real PMS is only ever selected for a practice
 * with BOTH `demoMode: false` AND `integrations.pmsProvider: 'openDental'`
 * set in its static config file — never something a runtime request or
 * an admin settings form can flip (see services/practice/practiceMerge.js,
 * which hard-codes `demoMode` and `integrations` as base-config-only
 * invariants).
 */

const MockPMSProvider = require('./MockPMSProvider');
const OpenDentalPMSProvider = require('./OpenDentalPMSProvider');

const mockInstance = new MockPMSProvider();
let openDentalInstance = null;

function getPMSProvider(practice) {
  if (practice?.demoMode !== false) return mockInstance;

  const providerName = practice?.integrations?.pmsProvider || 'none';
  switch (providerName) {
    case 'openDental':
      if (!openDentalInstance) openDentalInstance = new OpenDentalPMSProvider();
      return openDentalInstance;
    case 'mock':
      return mockInstance;
    case 'none':
      return null; // PMS not configured for this practice at all — callers must check for this
    default:
      console.warn(`No real "${providerName}" PMS provider is implemented yet — falling back to the mock provider.`);
      return mockInstance;
  }
}

/** Whether this practice has PMS integration turned on at all (spec §2's routing decision — orthogonal to demoMode, which only decides mock-vs-real ONCE PMS is turned on). */
function isPmsEnabled(practice) {
  const name = practice?.integrations?.pmsProvider;
  return Boolean(name && name !== 'none');
}

module.exports = { getPMSProvider, isPmsEnabled };
