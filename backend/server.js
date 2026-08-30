const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
require('dotenv').config();

const practiceContext = require('./middleware/practiceContext');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS: restrict to configured origin(s) in production. CORS_ORIGIN can be a
// single URL or a comma-separated list (e.g. the Vercel frontend URL plus a
// preview-deploy URL). Falls back to '*' only so the demo keeps working out
// of the box — tighten this before handling real patient data for real
// practices (see README "Security" section).
//
// `credentials: true` is required for Phase 3's admin session cookie to ever
// be sent/received cross-origin (the dashboard is a separate frontend
// origin from the API). Browsers reject a literal `*` Access-Control-Allow-
// Origin whenever credentials are involved, so when CORS_ORIGIN is left at
// its demo default this reflects the request's own Origin header back
// instead of a literal '*' — functionally open (same as before), but in the
// one header shape that still works with cookies. Set CORS_ORIGIN to your
// real frontend URL(s) before handling real patient data.
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (allowedOrigins.includes('*')) return callback(null, true);
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '200kb' }));
// Phase 4: Twilio (and any TwiML-webhook telephony provider) POSTs its
// webhooks as classic form-encoded bodies, not JSON — required for
// routes/voice.js to ever see CallSid/From/To/SpeechResult/etc in req.body.
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser());

// Railway (and most PaaS hosts) terminate TLS in front of this app, so
// without this, req.protocol/req.ip would report the internal proxy hop
// instead of the real client. This matters concretely for Phase 4's
// Twilio webhook signature verification (middleware/voicePracticeContext.js),
// which must reconstruct the exact public https:// URL Twilio signed
// against — get it wrong and every real webhook signature "fails" even
// though nothing was actually forged.
app.set('trust proxy', true);

// Connect to MongoDB. Disabling command buffering + a short serverSelection
// timeout means a down/unreachable database fails FAST (milliseconds)
// instead of every query hanging for Mongoose's 10s buffering default —
// routes that touch the DB (availability, appointments, analytics) already
// catch that failure and fall back gracefully, but only if it happens quickly
// enough that the UI doesn't feel frozen.
mongoose.set('bufferCommands', false);
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err.message));

// Health check is practice-agnostic — deliberately registered BEFORE the
// practiceContext middleware below so it never 404s over an unknown/missing
// practiceId (useful for uptime checks that don't send that header).
app.get('/api/health', (req, res) => {
  res.json({ status: 'AI Receptionist Server is running! ✅' });
});

// Phase 4: voice webhooks are registered BEFORE practiceContext below for
// the same reason /api/health is — this router resolves its OWN practice
// (from the dialed number, via middleware/voicePracticeContext.js) and
// verifies the telephony provider's webhook signature itself. It must
// never go through the X-Practice-Id-header-based practiceContext
// middleware, which a phone call has no way to send.
app.use('/api', require('./routes/voice'));

// Every route after this point knows WHICH practice it's serving —
// see middleware/practiceContext.js. This is the multi-tenancy boundary:
// req.practice/req.practiceId are attached here and used everywhere else
// instead of any route importing a specific clinic's config directly.
app.use('/api', practiceContext);

// Routes — each router owns one slice of the API. See backend/routes/*.
app.use('/api', require('./routes/practice'));
app.use('/api', require('./routes/chat'));
app.use('/api', require('./routes/leads'));
app.use('/api', require('./routes/appointments'));
app.use('/api', require('./routes/availability'));
app.use('/api', require('./routes/faqs'));
app.use('/api', require('./routes/insurance'));
app.use('/api', require('./routes/handoff'));
app.use('/api', require('./routes/analytics'));
app.use('/api', require('./routes/calendarAuth'));

// Phase 3 — admin authentication + clinic dashboard. Every route in these
// routers (except /admin/login itself) is protected by requireAuth() and
// resolves req.practice/req.practiceId from the authenticated admin's own
// session, never from the X-Practice-Id header the routes above use — see
// middleware/authMiddleware.js.
app.use('/api', require('./routes/adminAuth'));
app.use('/api', require('./routes/adminSettings'));
app.use('/api', require('./routes/adminDashboard'));
app.use('/api', require('./routes/adminAppointments'));
app.use('/api', require('./routes/adminConversations'));
app.use('/api', require('./routes/adminHandoffs'));
app.use('/api', require('./routes/adminCalendarAuth'));
app.use('/api', require('./routes/adminVoice'));

// Start Server
app.listen(PORT, () => {
  console.log(`\n🚀 AI Receptionist Server`);
  console.log(`📍 Running on: http://localhost:${PORT}`);
  console.log(`✅ Ready to accept connections!\n`);
});
