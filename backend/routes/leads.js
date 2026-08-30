const express = require('express');
const leadRepository = require('../repositories/LeadRepository');
const { requireFields, enforceMaxLengths } = require('../middleware/validate');

const router = express.Router();

router.post('/leads', enforceMaxLengths(['name', 'phone', 'email', 'message']), async (req, res) => {
  try {
    const missing = requireFields(req.body, ['name', 'phone']);
    if (missing) return res.status(400).json({ error: missing });

    const { name, email, phone, message } = req.body;
    const newLead = await leadRepository.create(req.practiceId, { name, email, phone, message });
    res.json({ success: true, message: 'Lead saved successfully', data: newLead });
  } catch (error) {
    console.error('Save Lead Error:', error);
    res.status(500).json({ error: 'Failed to save lead' });
  }
});

router.get('/leads', async (req, res) => {
  try {
    const leads = await leadRepository.findAll(req.practiceId);
    res.json(leads);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

module.exports = router;
