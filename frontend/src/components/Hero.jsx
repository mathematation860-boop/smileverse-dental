import React, { useRef } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Premium hero section. Purely presentational beyond the existing
 * onBookClick/onChatClick handlers — no new business logic, no new network
 * calls. The "3D" tooth/AI visual is hand-built from CSS + inline SVG
 * (gradients, layered shadows, a subtle pointer-tracked tilt) rather than a
 * 3D/WebGL library, so it adds no new dependency and can't break the
 * production build.
 */
function Hero({ practiceConfig, apiStatus, onBookClick, onChatClick }) {
  const { t } = useLanguage();
  const visualRef = useRef(null);

  const handlePointerMove = (e) => {
    if (prefersReducedMotion()) return;
    const el = visualRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5; // -0.5..0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--sv-tilt-x', `${(-py * 10).toFixed(2)}deg`);
    el.style.setProperty('--sv-tilt-y', `${(px * 12).toFixed(2)}deg`);
  };

  const resetTilt = () => {
    const el = visualRef.current;
    if (!el) return;
    el.style.setProperty('--sv-tilt-x', '0deg');
    el.style.setProperty('--sv-tilt-y', '0deg');
  };

  return (
    <header className="sv-hero">
      <div className="sv-hero-glow sv-hero-glow-1" aria-hidden="true" />
      <div className="sv-hero-glow sv-hero-glow-2" aria-hidden="true" />
      <div className="sv-hero-grid" aria-hidden="true" />

      <div className="sv-hero-content">
        <div className="sv-header-brand">
          <div className="sv-logo" aria-hidden="true">🦷</div>
          <div>
            <h1>{practiceConfig.name || 'SmileVerse Dental'}</h1>
            <p className="sv-subtitle">{practiceConfig.tagline || t.brand.taglineFallback}</p>
          </div>
        </div>

        <div className="sv-hero-columns">
          <div className="sv-hero-copy">
            <div className={`sv-hero-badge sv-status-${apiStatus}`}>
              <span className="sv-status-dot" />
              <span>
                {apiStatus === 'connected' && t.hero.badge}
                {apiStatus === 'checking' && t.status.checking}
                {apiStatus === 'error' && t.status.error}
              </span>
            </div>

            <h2 className="sv-hero-title">{t.hero.title}</h2>
            <p className="sv-hero-subtitle">{t.hero.subtitle}</p>

            <div className="sv-hero-ctas">
              <button type="button" className="sv-btn sv-btn-hero-primary" onClick={onChatClick}>
                <span className="sv-btn-icon" aria-hidden="true">💬</span> {t.hero.ctaChat}
              </button>
              <button type="button" className="sv-btn sv-btn-hero-secondary" onClick={onBookClick}>
                <span className="sv-btn-icon" aria-hidden="true">📅</span> {t.hero.ctaBook}
              </button>
            </div>
          </div>

          <div
            className="sv-hero-visual"
            ref={visualRef}
            onMouseMove={handlePointerMove}
            onMouseLeave={resetTilt}
          >
            <div className="sv-visual-tilt">
              <div className="sv-particle sv-particle-1" aria-hidden="true" />
              <div className="sv-particle sv-particle-2" aria-hidden="true" />
              <div className="sv-particle sv-particle-3" aria-hidden="true" />

              <div className="sv-tooth-3d" aria-hidden="true">
                <svg viewBox="0 0 200 220" width="100%" height="100%">
                  <defs>
                    <linearGradient id="sv-tooth-face" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#fffdfa" />
                      <stop offset="55%" stopColor="#fff1e4" />
                      <stop offset="100%" stopColor="#ffd9b8" />
                    </linearGradient>
                    <linearGradient id="sv-tooth-shine" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                    </linearGradient>
                    <filter id="sv-tooth-shadow" x="-40%" y="-40%" width="180%" height="180%">
                      <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#c94f3d" floodOpacity="0.28" />
                    </filter>
                  </defs>
                  <g filter="url(#sv-tooth-shadow)">
                    <path
                      fill="url(#sv-tooth-face)"
                      d="M100 8c-24 0-33 14-46 14-15 0-30-10-40 4-9 13-3 33 2 47 6 17 8 45 20 68 8 16 16 27 26 27 12 0 12-30 20-30s8 30 20 30c10 0 18-11 26-27 12-23 14-51 20-68 5-14 11-34 2-47-10-14-25-4-40-4-13 0-22-14-46-14z"
                    />
                  </g>
                  <path
                    fill="url(#sv-tooth-shine)"
                    d="M66 30c-10 4-16 12-18 22 8-6 20-10 32-9-2-6-7-11-14-13z"
                    opacity="0.8"
                  />
                </svg>
              </div>

              <div className="sv-ai-orb" aria-hidden="true">
                <span className="sv-ai-orb-core" />
                <span className="sv-ai-orb-ring" />
              </div>

              <div className="sv-ai-preview-card">
                <div className="sv-ai-preview-header">
                  <span className="sv-ai-preview-avatar">🦷</span>
                  <div>
                    <p className="sv-ai-preview-name">{t.hero.previewName}</p>
                    <p className="sv-ai-preview-status">
                      <span className="sv-ai-preview-dot" /> {t.hero.previewOnline}
                    </p>
                  </div>
                </div>
                <div className="sv-ai-preview-bubble">{t.hero.previewGreeting}</div>
                <div className="sv-ai-preview-chips">
                  <button type="button" className="sv-mini-chip" onClick={onBookClick}>📅 {t.quickActions.book}</button>
                  <button type="button" className="sv-mini-chip" onClick={onChatClick}>💲 {t.quickActions.prices}</button>
                  <button type="button" className="sv-mini-chip" onClick={onChatClick}>🛡️ {t.quickActions.insurance}</button>
                  <button type="button" className="sv-mini-chip sv-mini-chip-emergency" onClick={onChatClick}>🚨 {t.quickActions.emergency}</button>
                  <button type="button" className="sv-mini-chip" onClick={onChatClick}>💁 {t.quickActions.human}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Hero;
