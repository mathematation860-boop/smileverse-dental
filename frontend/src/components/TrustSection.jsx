import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

const TRUST_ITEMS = [
  { key: 'support', icon: '🕐' },
  { key: 'scheduling', icon: '📅' },
  { key: 'insurance', icon: '🛡️' },
  { key: 'emergency', icon: '🚨' },
  { key: 'handoff', icon: '💁' },
  { key: 'multilingual', icon: '🌐' },
];

/**
 * Purely presentational trust/capability section — communicates what the
 * AI receptionist product does. No data fetching, no state.
 */
function TrustSection() {
  const { t } = useLanguage();

  return (
    <section className="sv-trust" aria-labelledby="sv-trust-title">
      <div className="sv-section-heading">
        <p className="sv-section-eyebrow">{t.trust.eyebrow}</p>
        <h2 id="sv-trust-title" className="sv-section-title">{t.trust.title}</h2>
        <p className="sv-section-subtitle">{t.trust.subtitle}</p>
      </div>
      <div className="sv-trust-grid">
        {TRUST_ITEMS.map((item, i) => (
          <div className="sv-trust-card" key={item.key} style={{ '--sv-stagger': i }}>
            <div className="sv-trust-icon" aria-hidden="true">{item.icon}</div>
            <h3>{t.trust.items[item.key].title}</h3>
            <p>{t.trust.items[item.key].body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default TrustSection;
