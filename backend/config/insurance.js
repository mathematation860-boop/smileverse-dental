/**
 * Configurable insurance data for this practice.
 *
 * IMPORTANT: This list is a DEMO placeholder. Never let the AI invent
 * coverage that isn't listed here — see services/insuranceService.js,
 * which only ever answers from this file and otherwise defers to the
 * front desk. A real clinic would replace `acceptedProviders` (and wire
 * up real-time eligibility checks) as part of onboarding.
 */

const insuranceConfig = {
  // Demo data — replace with the practice's real accepted plans.
  acceptedProviders: [
    'Delta Dental',
    'Cigna Dental',
    'MetLife',
    'Guardian',
    'Aetna Dental',
  ],
  notes:
    'We accept most PPO dental insurance plans. HMO plans and out-of-network plans may not be accepted — ' +
    'our front desk can verify your specific plan and estimate your out-of-pocket cost before your visit.',
  notesUr:
    'ہم زیادہ تر PPO ڈینٹل انشورنس پلانز قبول کرتے ہیں۔ HMO یا نیٹ ورک سے باہر پلانز شاید قبول نہ ہوں — ' +
    'ہمارا فرنٹ ڈیسک آپ کے مخصوص پلان کی تصدیق کر سکتا ہے۔',
};

module.exports = insuranceConfig;
