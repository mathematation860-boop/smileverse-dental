const mongoose = require('mongoose');

/**
 * Admin-editable overrides for one practice (Phase 3 §10 Practice
 * Settings). Deliberately loose/`Mixed`-friendly on the nested shapes
 * (hours/services/insurance/faqs/policies/aiConfig) rather than a fully
 * strict nested schema — the actual shape validation and sanitization
 * already happened in services/practice/settingsValidation.js before
 * this ever gets saved, and services/practice/practiceMerge.js is the
 * single place that decides what each field means when merged onto the
 * static base config. Mongoose's schema here exists to give the
 * document structure and a practiceId index, not to re-validate.
 */
const practiceSettingsSchema = new mongoose.Schema(
  {
    practiceId: { type: String, required: true, unique: true, index: true },
    name: String,
    tagline: String,
    phone: String,
    email: String,
    address: String,
    website: String,
    timezone: String,
    hours: {
      display: String,
      openDays: [Number],
      openTime: String,
      closeTime: String,
      slotMinutes: Number,
    },
    services: [
      {
        id: String,
        name: String,
        price: { type: Number, default: null },
        duration: Number,
        description: String,
        eligiblePatientTypes: [String],
        _id: false,
      },
    ],
    insurance: {
      acceptedProviders: [String],
      notes: String,
    },
    faqs: [
      {
        id: String,
        label: String,
        items: [{ id: String, question: String, answer: String, _id: false }],
        _id: false,
      },
    ],
    policies: {
      cancellationSummary: String,
      emergencySummary: String,
    },
    aiConfig: {
      customInstructions: String,
    },
    updatedBy: { type: String, default: null }, // adminId, for an audit trail
  },
  { timestamps: true }
);

module.exports = mongoose.models.PracticeSettings || mongoose.model('PracticeSettings', practiceSettingsSchema);
