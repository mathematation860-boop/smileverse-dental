const mongoose = require('mongoose');

/**
 * One real calendar connection per practice. `refreshToken`/`accessToken`
 * are OAuth secrets — `select: false` means a normal `.find()`/`.findOne()`
 * never returns them unless a query explicitly asks with `.select('+refreshToken')`,
 * so an accidental `res.json(connection)` elsewhere in the app can't leak
 * them (see repositories/CalendarConnectionRepository.js, the only place
 * that reads them, and routes/calendarAuth.js, which never returns this
 * document directly to a client).
 */
const calendarConnectionSchema = new mongoose.Schema({
  practiceId: { type: String, required: true, unique: true, index: true },
  provider: { type: String, enum: ['google'], default: 'google' },
  calendarId: { type: String, default: 'primary' },
  connectedEmail: { type: String, default: null },
  refreshToken: { type: String, required: true, select: false },
  accessToken: { type: String, select: false },
  accessTokenExpiry: { type: Date, select: false },
  scope: { type: String, default: null },
  connectedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

module.exports = mongoose.models.CalendarConnection || mongoose.model('CalendarConnection', calendarConnectionSchema);
