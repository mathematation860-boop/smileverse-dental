const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error:', err.message));

// Database Schemas
const leadSchema = new mongoose.Schema({
  name: String,
  email: String,
  phone: String,
  message: String,
  savedAt: { type: Date, default: Date.now }
});
const Lead = mongoose.model('Lead', leadSchema);

const appointmentSchema = new mongoose.Schema({
  name: String,
  phone: String,
  service: String,
  date: String,
  time: String,
  status: { type: String, default: 'Confirmed' },
  confirmedAt: { type: Date, default: Date.now }
});
const Appointment = mongoose.model('Appointment', appointmentSchema);

// Initialize Gemini Client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Clinic Information
const clinicInfo = {
  name: 'SmileVerse Dental',
  hours: '9:00 AM - 5:00 PM (Monday-Friday)',
  phone: '+1-555-SMILE-01',
  email: 'info@smileverse.com',
  address: '123 Dental Lane, Smile City, SC 12345',
  website: '[www.smileverse.com](https://www.smileverse.com)',
  services: [
    { name: 'Cleaning', price: '$150', duration: '45 mins' },
    { name: 'Root Canal', price: '$800', duration: '90 mins' },
    { name: 'Whitening', price: '$200', duration: '60 mins' },
    { name: 'Filling', price: '$250', duration: '45 mins' },
    { name: 'Extraction', price: '$300', duration: '30 mins' },
    { name: 'Crown', price: '$1200', duration: '120 mins' }
  ]
};

// System Prompt (Urdu + English)
const systemPrompt = `You are SmileVerse Dental's AI Receptionist. آپ SmileVerse Dental کے AI Receptionist ہیں۔
CLINIC INFORMATION:
- Name: SmileVerse Dental
- Hours: 9:00 AM - 5:00 PM (Monday-Friday) | اردو: پیر سے جمعہ 9 صبح - 5 شام
- Phone: +1-555-SMILE-01
- Email: info@smileverse.com
- Address: 123 Dental Lane, Smile City, SC 12345
- Website: [www.smileverse.com](https://www.smileverse.com)
SERVICES & PRICES:
- Cleaning: $150 (45 mins) | صفائی: $150
- Root Canal: $800 (90 mins) | روٹ کینال: $800
- Whitening: $200 (60 mins) | سفیدی: $200
- Filling: $250 (45 mins) | بھرائی: $250
- Extraction: $300 (30 mins) | نکلوانا: $300
- Crown: $1200 (120 mins) | تاج: $1200
IMPORTANT RULES:
1. صرف اوپر دی گئی معلومات دیں | Only provide information listed above
2. کبھی نئی سروسز یا قیمتیں ایجاد نہ کریں | Never invent services or prices
3. گرم اور پیشہ ورانہ ہو | Be warm and professional
4. اردو اور انگریزی دونوں میں جواب دے سکتے ہو | Support both Urdu and English
5. اگر ڈاکٹر کی ضرورت ہو تو انسان کو منتقل کریں | Escalate to human for medical advice
6. سہولتیں بہم پہنچانے کی حوصلہ افزائی کریں | Encourage appointments
APPOINTMENT BOOKING:
- Collect: name, phone, preferred service, date/time
- Confirm within 24 hours
- Send SMS/Email reminder
CONVERSATION STYLE:
- Be concise but friendly
- Answer service/pricing/hours directly
- For complex issues, ask for contact info
- Always be helpful
Now assist the patient in Urdu or English!`;

// Conversation storage (in-memory for demo)
const conversations = new Map();

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { conversationId, message, history } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    // Build conversation history for Gemini
    const messages = history || [];
    messages.push({ role: 'user', content: message });
    // Call Gemini API
    const geminiModel = genAI.getGenerativeModel({
      model: 'gemini-3.6-flash',
      systemInstruction: systemPrompt
    });
    const geminiHistory = messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    while (geminiHistory.length && geminiHistory[0].role !== 'user') {
      geminiHistory.shift();
    }
    const chat = geminiModel.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(message);
    const assistantMessage = result.response.text();
    // Store conversation
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, []);
    }
    const conv = conversations.get(conversationId);
    conv.push({ role: 'user', content: message });
    conv.push({ role: 'assistant', content: assistantMessage });
    res.json({
      success: true,
      message: assistantMessage,
      conversationId: conversationId
    });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      details: error.message
    });
  }
});

// Get Clinic Info
app.get('/api/clinic-info', (req, res) => {
  res.json(clinicInfo);
});

// Save Lead
app.post('/api/leads', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }
    const newLead = new Lead({ name, email, phone, message });
    await newLead.save();
    res.json({
      success: true,
      message: 'Lead saved successfully',
      data: newLead
    });
  } catch (error) {
    console.error('Save Lead Error:', error);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

// Get All Leads
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await Lead.find().sort({ savedAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// Book Appointment
app.post('/api/appointments', async (req, res) => {
  try {
    const { name, phone, service, date, time } = req.body;
    if (!name || !phone || !service || !date) {
      return res.status(400).json({ error: 'Required fields missing' });
    }
    const newAppointment = new Appointment({ name, phone, service, date, time });
    await newAppointment.save();
    res.json({
      success: true,
      message: 'Appointment booked successfully',
      data: newAppointment
    });
  } catch (error) {
    console.error('Book Appointment Error:', error);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// Get All Appointments
app.get('/api/appointments', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ confirmedAt: -1 });
    res.json(appointments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch appointments' });
  }
});

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