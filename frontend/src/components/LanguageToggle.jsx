import React from 'react';
import { useLanguage } from '../i18n/LanguageContext';

function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="sv-lang-toggle" role="group" aria-label={t.language.label}>
      <button
        type="button"
        className={`sv-lang-btn ${language === 'en' ? 'sv-lang-active' : ''}`}
        onClick={() => setLanguage('en')}
      >
        {t.language.en}
      </button>
      <button
        type="button"
        className={`sv-lang-btn ${language === 'ur' ? 'sv-lang-active' : ''}`}
        onClick={() => setLanguage('ur')}
      >
        {t.language.ur}
      </button>
    </div>
  );
}

export default LanguageToggle;
