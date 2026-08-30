import React from 'react';
import LanguageToggle from './LanguageToggle';

function TopBar({ practiceConfig }) {
  return (
    <div className="sv-topbar">
      <div className="sv-topbar-items">
        {practiceConfig.demoMode && <span className="sv-demo-badge" title="Demo mode — mock data, no real practice is connected">DEMO</span>}
        <span className="sv-topbar-item">📞 {practiceConfig.phone}</span>
        <span className="sv-topbar-item">🕐 {practiceConfig.hours?.display}</span>
        <span className="sv-topbar-item">📍 {practiceConfig.address}</span>
      </div>
      <LanguageToggle />
    </div>
  );
}

export default TopBar;
