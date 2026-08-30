const mongoose = require('mongoose');

/**
 * A practice-scoped admin account (Phase 3).
 *
 * Every admin belongs to exactly one practice (`practiceId`) — a
 * `super_admin` is still a row in this same collection, just with a role
 * that a later phase can grant cross-practice read access to; nothing in
 * this schema itself grants that (see authMiddleware.js "practice
 * isolation" comment for how that boundary is actually enforced today).
 *
 * `passwordHash` is never selected by default (`select: false`) so a
 * plain `AdminUser.find()` anywhere in the app can never accidentally
 * leak a hash into a JSON response — the login route explicitly opts in
 * with `.select('+passwordHash')` because it's the one place that
 * legitimately needs it.
 */
const adminUserSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['practice_admin', 'super_admin'], default: 'practice_admin' },
  active: { type: Boolean, default: true },
  lastLoginAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// An email is unique PER PRACTICE, not globally — two different practices
// are free to each have an admin@theirclinic.com without colliding, which
// matters once this product serves more than one practice.
adminUserSchema.index({ practiceId: 1, email: 1 }, { unique: true });

module.exports = mongoose.models.AdminUser || mongoose.model('AdminUser', adminUserSchema);
