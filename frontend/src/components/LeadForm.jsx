import React, { useState } from 'react';
import api from '../services/api';
import { useLanguage } from '../i18n/LanguageContext';

function LeadForm({ onSaved, onClose }) {
  const { t } = useLanguage();
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Please enter your name and phone number.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await api.saveLead(form);
      onSaved && onSaved(form);
      setForm({ name: '', email: '', phone: '', message: '' });
    } catch (err) {
      setError('Sorry, we could not save your information right now. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sv-card sv-form-card sv-form-lead">
      <h3>💌 {t.lead.title}</h3>
      <input
        type="text"
        placeholder={t.lead.fullName}
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <input
        type="email"
        placeholder={t.lead.email}
        value={form.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <input
        type="text"
        placeholder={t.lead.phone}
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
      />
      <textarea
        placeholder={t.lead.message}
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
      />
      {error && <p className="sv-error-text">{error}</p>}
      <button type="button" className="sv-btn sv-btn-confirm" onClick={submit} disabled={saving}>
        {t.lead.submit}
      </button>
    </div>
  );
}

export default LeadForm;
