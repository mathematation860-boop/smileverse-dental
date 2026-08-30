const express = require('express');
const cors = require('cors');
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
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map((o) => o.trim());
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
  })
);
app.use(express.json({ limit: '200kb' }));

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

// Start Server
app.listen(PORT, () => {
  console.log(`\n🚀 AI Receptionist Server`);
  console.log(`📍 Running on: http://localhost:${PORT}`);
  console.log(`✅ Ready to accept connections!\n`);
});
