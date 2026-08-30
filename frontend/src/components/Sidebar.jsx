import React, { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import LeadForm from './LeadForm';

function Sidebar({ practiceConfig, stats, onShowFaq, onShowInsurance, onLeadSaved }) {
  const { t } = useLanguage();
  const [showLeadForm, setShowLeadForm] = useState(false);
  const pricedServices = (practiceConfig.services || []).filter((s) => s.price != null);

  return (
    <aside className="sv-sidebar">
      <div className="sv-card">
        <h3>🪥 {t.sidebar.services}</h3>
        <ul className="sv-list">
          {pricedServices.map((s) => (
            <li key={s.id || s.name}>
              <span>{s.name}</span>
              <span className="sv-list-meta">
                ${s.price} <em>({s.duration} mins)</em>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="sv-card sv-sidebar-links">
        <button type="button" className="sv-link-btn" onClick={onShowFaq}>❓ {t.faq.title}</button>
        <button type="button" className="sv-link-btn" onClick={onShowInsurance}>🛡️ {t.quickActions.insurance}</button>
        <button type="button" className="sv-link-btn" onClick={() => setShowLeadForm((v) => !v)}>💌 {t.lead.title}</button>
      </div>

      {showLeadForm && (
        <LeadForm
          onSaved={() => {
            setShowLeadForm(false);
            onLeadSaved && onLeadSaved();
          }}
        />
      )}

      <div className="sv-card">
        <h3>💛 {t.sidebar.contact}</h3>
        <p className="sv-contact-line">📞 {practiceConfig.phone}</p>
        <p className="sv-contact-line">✉️ {practiceConfig.email}</p>
        <p className="sv-contact-line">🕐 {practiceConfig.hours?.display}</p>
        {practiceConfig.address && <p className="sv-contact-line">📍 {practiceConfig.address}</p>}
      </div>

      <div className="sv-card sv-stats-card">
        <h3>✨ {t.sidebar.statsTitle}</h3>
        <div className="sv-stats-grid">
          <div className="sv-stat">
            <span className="sv-stat-number">{stats.messages}</span>
            <span className="sv-stat-label">{t.sidebar.statMessages}</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-number">{stats.leads}</span>
            <span className="sv-stat-label">{t.sidebar.statLeads}</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-number">{stats.appointments}</span>
            <span className="sv-stat-label">{t.sidebar.statAppointments}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
