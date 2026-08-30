import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import strings from './strings';

const LanguageContext = createContext(null);

function readStoredLanguage() {
  try {
    const stored = window.localStorage.getItem('sv_language');
    return stored === 'ur' ? 'ur' : 'en';
  } catch (e) {
    return 'en';
  }
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage);

  const setLanguage = useCallback((lang) => {
    const next = lang === 'ur' ? 'ur' : 'en';
    setLanguageState(next);
    try {
      window.localStorage.setItem('sv_language', next);
    } catch (e) {
      // ignore — localStorage may be unavailable
    }
  }, []);

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t: strings[language],
      dir: language === 'ur' ? 'rtl' : 'ltr',
    }),
    [language, setLanguage]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
