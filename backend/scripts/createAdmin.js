#!/usr/bin/env node
/**
 * One-time (or occasional) CLI to create/reset an admin account.
 *
 * There is deliberately no public "sign up" HTTP endpoint — an admin
 * account grants access to real patient data for one practice, so
 * creating one is an operational action performed by whoever runs the
 * server, not something reachable by URL (same reasoning as
 * routes/calendarAuth.js's original CALENDAR_ADMIN_SECRET stopgap, which
 * this whole phase exists to replace with something better for the
 * *usage* side — but account creation itself still isn't a web form).
 *
 * Usage:
 *   node scripts/createAdmin.js --practiceId=smileverse-dental \
 *     --name="Dr. Ayesha Khan" --email=admin@smileverse.com \
 *     --password="a-strong-password" --role=practice_admin
 *
 * Re-running with the same practiceId+email updates the name/password/
 * role/active flag on the existing account instead of erroring, so this
 * script also doubles as "reset a forgotten password".
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AdminUser = require('../models/AdminUser');
const { getPractice } = require('../config/practiceRepository');
const { hashPassword } = require('../services/auth/passwordHashing');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { practiceId, name, email, password } = args;
  const role = args.role === 'super_admin' ? 'super_admin' : 'practice_admin';

  if (!practiceId || !name || !email || !password) {
    console.error('Usage: node scripts/createAdmin.js --practiceId=... --name="..." --email=... --password=... [--role=practice_admin|super_admin]');
    process.exit(1);
  }
  if (!getPractice(practiceId)) {
    console.error(`Unknown practiceId "${practiceId}" — check config/practiceRepository.js.`);
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is not set — cannot create an admin without a database.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });

  const passwordHash = await hashPassword(password);
  const normalizedEmail = String(email).toLowerCase();

  const admin = await AdminUser.findOneAndUpdate(
    { practiceId, email: normalizedEmail },
    { $set: { name, passwordHash, role, active: true, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, new: true }
  );

  console.log(`✅ Admin ready: ${admin.email} (${admin.role}) for practice "${practiceId}".`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
