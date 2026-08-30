const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

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

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ status: 'AI Receptionist Server is running! ✅' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`\n🚀 SmileVerse Dental AI Receptionist Server`);
  console.log(`📍 Running on: http://localhost:${PORT}`);
  console.log(`✅ Ready to accept connections!\n`);
});
