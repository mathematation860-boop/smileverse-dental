const express = require('express');
const Lead = require('../models/Lead');

const router = express.Router();

router.post('/leads', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }
    const newLead = new Lead({ name, email, phone, message });
    await newLead.save();
    res.json({ success: true, message: 'Lead saved successfully', data: newLead });
  } catch (error) {
    console.error('Save Lead Error:', error);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const leads = await Lead.find().sort({ savedAt: -1 });
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

module.exports = router;
