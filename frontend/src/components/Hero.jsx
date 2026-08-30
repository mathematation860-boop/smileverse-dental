import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

function Hero({ practiceConfig, apiStatus, onBookClick, onChatClick }) {
  const { t } = useLanguage();

  return (
    <header className="sv-hero">
      <svg className="sv-header-blob sv-blob-1" viewBox="0 0 200 200" aria-hidden="true">
        <path
          fill="currentColor"
          d="M45.3,-58.5C58.4,-49.6,68.4,-35.1,71.8,-19.2C75.2,-3.3,72,13.9,63.8,28.1C55.6,42.3,42.4,53.4,27.4,60.6C12.4,67.8,-4.4,71.1,-20.1,67.6C-35.8,64.1,-50.4,53.8,-59.8,39.9C-69.2,26,-73.4,8.5,-70.7,-7.6C-68,-23.7,-58.4,-38.4,-45.6,-47.5C-32.8,-56.6,-16.4,-60.1,0.5,-60.8C17.4,-61.5,34.8,-59.4,45.3,-58.5Z"
          transform="translate(100 100)"
        />
      </svg>
      <svg className="sv-header-blob sv-blob-2" viewBox="0 0 200 200" aria-hidden="true">
        <path
          fill="currentColor"
          d="M39.2,-49.8C50.2,-41.6,58,-28.5,61.4,-14.1C64.8,0.3,63.8,16,56.7,28.6C49.6,41.2,36.4,50.7,21.7,56.5C7,62.3,-9.2,64.4,-23.6,60.1C-38,55.8,-50.6,45.1,-58.2,31.4C-65.8,17.7,-68.4,1,-64.9,-14.1C-61.4,-29.2,-51.8,-42.7,-39.3,-50.8C-26.8,-58.9,-13.4,-61.6,0.6,-62.4C14.6,-63.2,28.2,-58,39.2,-49.8Z"
          transform="translate(100 100)"
        />
      </svg>

      <div className="sv-hero-content">
        <div className="sv-header-brand">
          <div className="sv-logo" aria-hidden="true">🦷</div>
          <div>
            <h1>{practiceConfig.name || 'SmileVerse Dental'}</h1>
            <p className="sv-subtitle">{practiceConfig.tagline || t.brand.taglineFallback}</p>
          </div>
        </div>

        <div className={`sv-status-badge sv-status-${apiStatus}`}>
          <span className="sv-status-dot" />
          {apiStatus === 'connected' && t.hero.eyebrow}
          {apiStatus === 'checking' && t.status.checking}
          {apiStatus === 'error' && t.status.error}
        </div>

        <h2 className="sv-hero-title">{t.hero.title}</h2>
        <p className="sv-hero-subtitle">{t.hero.subtitle}</p>

        <div className="sv-hero-ctas">
          <button type="button" className="sv-btn sv-btn-hero-primary" onClick={onBookClick}>
            📅 {t.hero.ctaBook}
          </button>
          <button type="button" className="sv-btn sv-btn-hero-secondary" onClick={onChatClick}>
            💬 {t.hero.ctaChat}
          </button>
        </div>
      </div>
    </header>
  );
}

export default Hero;
