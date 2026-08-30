import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { useLanguage } from '../i18n/LanguageContext';

function InsurancePanel({ onClose }) {
  const { t, language } = useLanguage();
  const [info, setInfo] = useState(null);
  const [provider, setProvider] = useState('');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api.getInsuranceInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  const check = async () => {
    if (!provider.trim()) return;
    setChecking(true);
    try {
      const res = await api.checkInsurance(provider.trim());
      setResult(res);
    } catch (err) {
      setResult({ status: 'unknown', message: "I don't have enough information to confirm that. I can connect you with our front desk team." });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="sv-modal-overlay" role="dialog" aria-modal="true">
      <div className="sv-modal sv-insurance-modal">
        <div className="sv-modal-header">
          <h3>🛡️ {t.quickActions.insurance}</h3>
          <button type="button" className="sv-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="sv-modal-body">
          {info && (
            <p className="sv-step-hint">
              {language === 'ur' ? info.notesUr : info.notes}
            </p>
          )}
          <div className="sv-insurance-check">
            <input
              type="text"
              placeholder="e.g. Delta Dental"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && check()}
            />
            <button type="button" className="sv-btn sv-btn-confirm sv-btn-small" onClick={check} disabled={checking}>
              {checking ? '…' : '✓'}
            </button>
          </div>
          {result && (
            <p className={result.status === 'accepted' ? 'sv-success-text' : 'sv-step-hint'}>{result.message}</p>
          )}
          {info?.acceptedProviders && (
            <ul className="sv-list sv-insurance-list">
              {info.acceptedProviders.map((p) => (
                <li key={p}><span>{p}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default InsurancePanel;
