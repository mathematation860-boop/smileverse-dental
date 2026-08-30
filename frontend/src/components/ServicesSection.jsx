import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

const SERVICE_ICONS = {
  cleaning: '🪥',
  consultation: '🗒️',
  root_canal: '🦷',
  whitening: '✨',
  filling: '🔧',
  extraction: '🦷',
  crown: '👑',
  emergency: '🚨',
  other: '➕',
};

/**
 * Premium services grid, reading directly from practiceConfig.services
 * (the same data the AI's answers and the booking flow use — nothing is
 * invented here). onBook opens the real BookingFlow prefilled with this
 * service; onAskAi scrolls to the real chat panel — no separate/duplicate
 * booking or chat logic.
 */
function ServicesSection({ services, onBook, onAskAi }) {
  const { t } = useLanguage();
  const list = services || [];

  if (!list.length) return null;

  return (
    <section className="sv-services-section" aria-labelledby="sv-services-title">
      <div className="sv-section-heading">
        <p className="sv-section-eyebrow">{t.services.eyebrow}</p>
        <h2 id="sv-services-title" className="sv-section-title">{t.services.title}</h2>
        <p className="sv-section-subtitle">{t.services.subtitle}</p>
      </div>
      <div className="sv-services-grid">
        {list.map((s, i) => (
          <div className="sv-service-card" key={s.id || s.name} style={{ '--sv-stagger': i }}>
            <div className="sv-service-icon" aria-hidden="true">{SERVICE_ICONS[s.id] || '🦷'}</div>
            <h3>{s.name}</h3>
            {s.description && <p className="sv-service-desc">{s.description}</p>}
            <div className="sv-service-meta">
              <span className="sv-service-price">
                {s.price != null ? `$${s.price}` : t.services.priceOnEval}
              </span>
              {s.duration && <span className="sv-service-duration">{s.duration} {t.services.minutesShort}</span>}
            </div>
            <div className="sv-service-actions">
              <button type="button" className="sv-btn sv-btn-outline sv-btn-small" onClick={onAskAi}>
                {t.services.askAi}
              </button>
              <button type="button" className="sv-btn sv-btn-confirm sv-btn-small" onClick={() => onBook({ serviceId: s.id })}>
                {t.services.bookThis}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ServicesSection;
