import React, { useEffect, useRef, useState } from 'react';
import './AIReceptionist.css';
import api from './services/api';
import defaultPracticeConfig from './config/defaultPracticeConfig';
import { useLanguage } from './i18n/LanguageContext';

import TopBar from './components/TopBar';
import Hero from './components/Hero';
import ChatPanel from './components/ChatPanel';
import Sidebar from './components/Sidebar';
import BookingFlow from './components/BookingFlow';
import FaqPanel from './components/FaqPanel';
import InsurancePanel from './components/InsurancePanel';

function AIReceptionist() {
  const { t } = useLanguage();
  const [conversationId] = useState(() => `conv_${Date.now()}`);
  const [practiceConfig, setPracticeConfig] = useState(defaultPracticeConfig);
  const [apiStatus, setApiStatus] = useState('checking');
  const [stats, setStats] = useState({ messages: 0, leads: 0, appointments: 0 });
  const [activeModal, setActiveModal] = useState(null); // 'booking' | 'faq' | 'insurance' | null
  const [bookingPrefill, setBookingPrefill] = useState({});

  const chatSectionRef = useRef(null);

  useEffect(() => {
    checkApiHealth();
    loadPracticeConfig();
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkApiHealth = async () => {
    try {
      await api.health();
      setApiStatus('connected');
    } catch (err) {
      setApiStatus('error');
    }
  };

  const loadPracticeConfig = async () => {
    try {
      const data = await api.getPracticeConfig();
      setPracticeConfig((prev) => ({ ...prev, ...data }));
    } catch (err) {
      // keep defaults silently — the app should still work if this call fails
    }
  };

  const refreshStats = async () => {
    try {
      const [leads, appointments] = await Promise.all([api.getAllLeads(), api.getAllAppointments()]);
      setStats((prev) => ({
        ...prev,
        leads: Array.isArray(leads) ? leads.length : 0,
        appointments: Array.isArray(appointments) ? appointments.length : 0,
      }));
    } catch (err) {
      // non-fatal — stats are a nice-to-have
    }
  };

  const openBooking = (prefill = {}) => {
    setBookingPrefill(prefill);
    setActiveModal('booking');
  };

  const scrollToChat = () => {
    chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sv-app">
      <TopBar practiceConfig={practiceConfig} />

      <Hero
        practiceConfig={practiceConfig}
        apiStatus={apiStatus}
        onBookClick={() => openBooking({})}
        onChatClick={scrollToChat}
      />

      <nav className="sv-navstrip">
        {(practiceConfig.services || []).filter((s) => s.price != null).map((s) => (
          <span className="sv-navstrip-item" key={s.id || s.name}>{s.name}</span>
        ))}
      </nav>

      <main className="sv-main">
        <ChatPanel
          conversationId={conversationId}
          practiceConfig={practiceConfig}
          onMessageCountChange={(count) => setStats((prev) => ({ ...prev, messages: count }))}
          onOpenBooking={openBooking}
          onOpenFaq={() => setActiveModal('faq')}
          onOpenInsurance={() => setActiveModal('insurance')}
          scrollTargetRef={chatSectionRef}
        />

        <Sidebar
          practiceConfig={practiceConfig}
          stats={stats}
          onShowFaq={() => setActiveModal('faq')}
          onShowInsurance={() => setActiveModal('insurance')}
          onLeadSaved={refreshStats}
        />
      </main>

      <footer className="sv-footer">{t.footer}</footer>

      {activeModal === 'booking' && (
        <BookingFlow
          practiceConfig={practiceConfig}
          prefill={bookingPrefill}
          conversationId={conversationId}
          onClose={() => setActiveModal(null)}
          onBooked={() => refreshStats()}
        />
      )}
      {activeModal === 'faq' && <FaqPanel onClose={() => setActiveModal(null)} />}
      {activeModal === 'insurance' && <InsurancePanel onClose={() => setActiveModal(null)} />}
    </div>
  );
}

export default AIReceptionist;
