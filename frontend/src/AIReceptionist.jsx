import React, { useState, useEffect, useRef } from 'react';
import './AIReceptionist.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const DEFAULT_CLINIC_INFO = {
  name: 'SmileVerse Dental',
  hours: '9 AM - 5 PM (Monday-Friday)',
  services: [
    { name: 'Cleaning', price: 150, duration: 45 },
    { name: 'Root Canal', price: 800, duration: 90 },
    { name: 'Whitening', price: 200, duration: 60 },
    { name: 'Filling', price: 250, duration: 45 },
    { name: 'Extraction', price: 300, duration: 30 },
    { name: 'Crown', price: 1200, duration: 120 },
  ],
  location: '123 Dental Lane, Smile City, SC 12345',
  phone: '+1-555-SMILE-01',
  email: 'info@smileverse.com',
};

const QUICK_QUESTIONS = [
  'What are your prices?',
  'What are your hours?',
  'I want to book an appointment',
  'Where are you located?',
];

function AIReceptionist() {
  const [conversationId] = useState(() => `conv_${Date.now()}`);
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        "Hi, I'm so glad you're here! 💛 Welcome to SmileVerse Dental. I'm your friendly AI receptionist — think of me as the warm voice at the front desk, just available all day and night. I can help you book a visit, check prices, or answer anything on your mind. What can I do for you today?",
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
  const [clinicInfo, setClinicInfo] = useState(DEFAULT_CLINIC_INFO);
  const [stats, setStats] = useState({ messages: 0, leads: 0, appointments: 0 });

  const [showLeadForm, setShowLeadForm] = useState(false);
  const [showBookingForm, setShowBookingForm] = useState(false);
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [bookingForm, setBookingForm] = useState({
    name: '',
    phone: '',
    service: 'Cleaning',
    date: '',
    time: '10:00 AM',
  });

  const messagesEndRef = useRef(null);

  useEffect(() => {
    checkApiHealth();
    loadClinicInfo();
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollToBottom();
    setStats((prev) => ({ ...prev, messages: messages.length }));
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const checkApiHealth = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/health`);
      setApiStatus(res.ok ? 'connected' : 'error');
    } catch (err) {
      setApiStatus('error');
    }
  };

  const loadClinicInfo = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clinic-info`);
      if (res.ok) {
        const data = await res.json();
        // Keep our own nicely-formatted services list; only borrow
        // contact-style fields from the backend if it provides them.
        setClinicInfo((prev) => ({
          ...prev,
          name: data.name || prev.name,
          hours: data.hours || prev.hours,
          location: data.location || prev.location,
          phone: data.phone || prev.phone,
          email: data.email || prev.email,
        }));
      }
    } catch (err) {
      // keep defaults silently
    }
  };

  const refreshStats = async () => {
    try {
      const [leadsRes, apptRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/leads`),
        fetch(`${API_BASE_URL}/api/appointments`),
      ]);
      const leadsData = leadsRes.ok ? await leadsRes.json() : [];
      const apptData = apptRes.ok ? await apptRes.json() : [];
      setStats((prev) => ({
        ...prev,
        leads: Array.isArray(leadsData) ? leadsData.length : 0,
        appointments: Array.isArray(apptData) ? apptData.length : 0,
      }));
    } catch (err) {
      // non-fatal
    }
  };

  const sendMessage = async (textOverride) => {
    const text = (textOverride ?? inputValue).trim();
    if (!text || isLoading) return;

    const userMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue('');
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
          history: updatedMessages,
        }),
      });

      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || data.message || "Sorry, I couldn't process that.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Oh no, I'm having a little trouble connecting right now 💭. Please try again in a moment — I'm not going anywhere!",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleLeadSubmit = async () => {
    if (!leadForm.name || !leadForm.phone) {
      alert('Please enter your name and phone number.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadForm),
      });
      if (!res.ok) throw new Error('Failed');

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Thank you so much, ${leadForm.name}! 💛 I've tucked your details away safely — someone from our team will reach out to you soon.`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setLeadForm({ name: '', email: '', phone: '', message: '' });
      setShowLeadForm(false);
      refreshStats();
    } catch (err) {
      alert('Sorry, we could not save your information right now. Please try again.');
    }
  };

  const bookAppointment = async () => {
    if (!bookingForm.name || !bookingForm.phone || !bookingForm.date) {
      alert('Please fill in your name, phone number, and preferred date.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookingForm),
      });
      if (!res.ok) throw new Error('Failed');

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `🎉 You're all set, ${bookingForm.name}!\n\nService: ${bookingForm.service}\nDate: ${bookingForm.date}\nTime: ${bookingForm.time}\n\nWe can't wait to see your smile at SmileVerse Dental!`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setBookingForm({ name: '', phone: '', service: 'Cleaning', date: '', time: '10:00 AM' });
      setShowBookingForm(false);
      refreshStats();
    } catch (err) {
      alert('Sorry, we could not book your appointment right now. Please try again.');
    }
  };

  return (
    <div className="sv-app">
      <div className="sv-topbar">
        <span className="sv-topbar-item">📞 {clinicInfo.phone}</span>
        <span className="sv-topbar-item">🕐 {clinicInfo.hours}</span>
        <span className="sv-topbar-item">📍 {clinicInfo.location}</span>
      </div>
      <header className="sv-header">
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
        <div className="sv-header-brand">
          <div className="sv-logo">🦷</div>
          <div>
            <h1>{clinicInfo.name || 'SmileVerse Dental'}</h1>
            <p className="sv-subtitle">Caring for your smile, one visit at a time 💛</p>
          </div>
        </div>
        <div className={`sv-status-badge sv-status-${apiStatus}`}>
          <span className="sv-status-dot" />
          {apiStatus === 'connected' && 'Here for you, 24/7'}
          {apiStatus === 'checking' && 'Getting ready...'}
          {apiStatus === 'error' && 'Connection Issue'}
        </div>
      </header>

      <nav className="sv-navstrip">
        {DEFAULT_CLINIC_INFO.services.map((s) => (
          <span className="sv-navstrip-item" key={s.name}>{s.name}</span>
        ))}
      </nav>

      <main className="sv-main">
        <section className="sv-chat-panel">
          <div className="sv-messages">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`sv-message-row ${msg.role === 'user' ? 'sv-row-user' : 'sv-row-bot'}`}
              >
                {msg.role !== 'user' && <div className="sv-avatar">🦷</div>}
                <div className={`sv-bubble ${msg.role === 'user' ? 'sv-bubble-user' : 'sv-bubble-bot'}`}>
                  {msg.content.split('\n').map((line, i) => (
                    <React.Fragment key={i}>
                      {line}
                      {i < msg.content.split('\n').length - 1 && <br />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="sv-message-row sv-row-bot">
                <div className="sv-avatar">🦷</div>
                <div className="sv-bubble sv-bubble-bot sv-typing">
                  <span className="sv-dot" />
                  <span className="sv-dot" />
                  <span className="sv-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length <= 1 && (
            <div className="sv-quick-replies">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} className="sv-chip" onClick={() => sendMessage(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}

          <div className="sv-input-bar">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message (Urdu/English)..."
              disabled={isLoading}
            />
            <button className="sv-send-btn" onClick={() => sendMessage()} disabled={isLoading}>
              ➤
            </button>
          </div>
        </section>

        <aside className="sv-sidebar">
          <div className="sv-action-buttons">
            <button
              className="sv-btn sv-btn-book"
              onClick={() => {
                setShowBookingForm(!showBookingForm);
                setShowLeadForm(false);
              }}
            >
              📅 Book Now
            </button>
            <button
              className="sv-btn sv-btn-save"
              onClick={() => {
                setShowLeadForm(!showLeadForm);
                setShowBookingForm(false);
              }}
            >
              💌 Save Info
            </button>
          </div>

          {showBookingForm && (
            <div className="sv-card sv-form-card">
              <h3>Let's Get You Booked 🗓️</h3>
              <input
                type="text"
                placeholder="Full Name"
                value={bookingForm.name}
                onChange={(e) => setBookingForm({ ...bookingForm, name: e.target.value })}
              />
              <input
                type="text"
                placeholder="Phone Number"
                value={bookingForm.phone}
                onChange={(e) => setBookingForm({ ...bookingForm, phone: e.target.value })}
              />
              <select
                value={bookingForm.service}
                onChange={(e) => setBookingForm({ ...bookingForm, service: e.target.value })}
              >
                {clinicInfo.services.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} - ${s.price}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={bookingForm.date}
                onChange={(e) => setBookingForm({ ...bookingForm, date: e.target.value })}
              />
              <input
                type="text"
                placeholder="Preferred Time"
                value={bookingForm.time}
                onChange={(e) => setBookingForm({ ...bookingForm, time: e.target.value })}
              />
              <button className="sv-btn sv-btn-confirm" onClick={bookAppointment}>
                Confirm My Visit
              </button>
            </div>
          )}

          {showLeadForm && (
            <div className="sv-card sv-form-card sv-form-lead">
              <h3>Stay In Touch 💌</h3>
              <input
                type="text"
                placeholder="Full Name"
                value={leadForm.name}
                onChange={(e) => setLeadForm({ ...leadForm, name: e.target.value })}
              />
              <input
                type="email"
                placeholder="Email Address"
                value={leadForm.email}
                onChange={(e) => setLeadForm({ ...leadForm, email: e.target.value })}
              />
              <input
                type="text"
                placeholder="Phone Number"
                value={leadForm.phone}
                onChange={(e) => setLeadForm({ ...leadForm, phone: e.target.value })}
              />
              <textarea
                placeholder="Anything you'd like us to know? (optional)"
                value={leadForm.message}
                onChange={(e) => setLeadForm({ ...leadForm, message: e.target.value })}
              />
              <button className="sv-btn sv-btn-confirm" onClick={handleLeadSubmit}>
                Save My Info
              </button>
            </div>
          )}

          <div className="sv-card">
            <h3>🪥 Our Services</h3>
            <ul className="sv-list">
              {clinicInfo.services.map((s) => (
                <li key={s.name}>
                  <span>{s.name}</span>
                  <span className="sv-list-meta">
                    ${s.price} <em>({s.duration} mins)</em>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="sv-card">
            <h3>💛 Say Hello</h3>
            <p className="sv-contact-line">📞 {clinicInfo.phone}</p>
            <p className="sv-contact-line">✉️ {clinicInfo.email}</p>
            <p className="sv-contact-line">🕐 {clinicInfo.hours}</p>
            {clinicInfo.location && <p className="sv-contact-line">📍 {clinicInfo.location}</p>}
          </div>

          <div className="sv-card sv-stats-card">
            <h3>✨ Today So Far</h3>
            <div className="sv-stats-grid">
              <div className="sv-stat">
                <span className="sv-stat-number">{stats.messages}</span>
                <span className="sv-stat-label">Messages</span>
              </div>
              <div className="sv-stat">
                <span className="sv-stat-number">{stats.leads}</span>
                <span className="sv-stat-label">Leads</span>
              </div>
              <div className="sv-stat">
                <span className="sv-stat-number">{stats.appointments}</span>
                <span className="sv-stat-label">Appointments</span>
              </div>
            </div>
          </div>
        </aside>
      </main>

      <footer className="sv-footer">
        Made with 🧡 for healthier smiles · Powered by Google Gemini
      </footer>
    </div>
  );
}

export default AIReceptionist;
