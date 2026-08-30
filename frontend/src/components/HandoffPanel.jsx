import React, { useState } from 'react';
import api from '../services/api';
import { useLanguage } from '../i18n/LanguageContext';

function HandoffPanel({ practiceConfig, conversationId, reason, onClose }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState(null); // 'request_callback' | 'send_message'
  const [form, setForm] = useState({ name: '', phone: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await api.requestHandoff({
        conversationId,
        reason,
        type: mode,
        name: form.name,
        phone: form.phone,
        message: form.message,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try calling the office directly.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sv-card sv-handoff-card">
      <h3>💁 {t.handoff.title}</h3>
      <p className="sv-step-hint">{t.handoff.subtitle}</p>

      {!mode && !submitted && (
        <div className="sv-handoff-actions">
          <a className="sv-btn sv-btn-outline sv-btn-small" href={`tel:${practiceConfig.phone}`}>
            📞 {t.handoff.callOffice}
          </a>
          <button type="button" className="sv-btn sv-btn-outline sv-btn-small" onClick={() => setMode('request_callback')}>
            ☎️ {t.handoff.requestCallback}
          </button>
          <button type="button" className="sv-btn sv-btn-outline sv-btn-small" onClick={() => setMode('send_message')}>
            ✉️ {t.handoff.sendMessage}
          </button>
        </div>
      )}

      {mode && !submitted && (
        <div className="sv-handoff-form">
          <input
            type="text"
            placeholder={t.handoff.namePlaceholder}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            type="text"
            placeholder={t.handoff.phonePlaceholder}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          {mode === 'send_message' && (
            <textarea
              placeholder={t.handoff.messagePlaceholder}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />
          )}
          {error && <p className="sv-error-text">{error}</p>}
          <button type="button" className="sv-btn sv-btn-confirm sv-btn-small" disabled={submitting} onClick={submit}>
            {t.handoff.submit}
          </button>
        </div>
      )}

      {submitted && <p className="sv-success-text">✓ {t.handoff.submitted}</p>}

      {onClose && (
        <button type="button" className="sv-modal-close sv-handoff-close" onClick={onClose} aria-label="Close">×</button>
      )}
    </div>
  );
}

export default HandoffPanel;
