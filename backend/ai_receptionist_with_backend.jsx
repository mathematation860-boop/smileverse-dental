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
        "Hello! 👋 Welcome to SmileVerse Dental. I'm your AI receptionist, here 24/7 to help with appointments, pricing, and any questions about our services. How can I help you today?",
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
        setClinicInfo({ ...DEFAULT_CLINIC_INFO, ...data });
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
          content: 'Sorry, something went wrong connecting to our assistant. Please try again in a moment.',
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
          content: `Thank you ${leadForm.name}! We've saved your information and someone from our team will reach out soon.`,
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
          content: `✅ Your appointment has been booked!\n\nName: ${bookingForm.name}\nService: ${bookingForm.service}\nDate: ${bookingForm.date}\nTime: ${bookingForm.time}\n\nWe look forward to seeing you at SmileVerse Dental!`,
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
      <header className="sv-header">
        <div className="sv-header-brand">
          <div className="sv-logo">🦷</div>
          <div>
            <h1>{clinicInfo.name || 'SmileVerse Dental'}</h1>
            <p className="sv-subtitle">AI-Powered Reception · Available 24/7</p>
          </div>
        </div>
        <div className={`sv-status-badge sv-status-${apiStatus}`}>
          <span className="sv-status-dot" />
          {apiStatus === 'connected' && 'Assistant Online'}
          {apiStatus === 'checking' && 'Connecting...'}
          {apiStatus === 'error' && 'Connection Issue'}
        </div>
      </header>

      <main className="sv-main">
        <section className="sv-chat-panel">
          <div className="sv-messages">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`sv-message-row ${msg.role === 'user' ? 'sv-row-user' : 'sv-row-bot'}`}
              >
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
              💾 Save Info
            </button>
          </div>

          {showBookingForm && (
            <div className="sv-card sv-form-card">
              <h3>Book an Appointment</h3>
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
                Confirm Booking
              </button>
            </div>
          )}

          {showLeadForm && (
            <div className="sv-card sv-form-card sv-form-lead">
              <h3>Save Your Information</h3>
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
                placeholder="Your message (optional)"
                value={leadForm.message}
                onChange={(e) => setLeadForm({ ...leadForm, message: e.target.value })}
              />
              <button className="sv-btn sv-btn-confirm" onClick={handleLeadSubmit}>
                Save
              </button>
            </div>
          )}

          <div className="sv-card">
            <h3>🦷 Services</h3>
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
            <h3>📍 Contact</h3>
            <p className="sv-contact-line">📞 {clinicInfo.phone}</p>
            <p className="sv-contact-line">✉️ {clinicInfo.email}</p>
            <p className="sv-contact-line">🕐 {clinicInfo.hours}</p>
            {clinicInfo.location && <p className="sv-contact-line">📌 {clinicInfo.location}</p>}
          </div>

          <div className="sv-card sv-stats-card">
            <h3>📊 Stats</h3>
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
        Powered by Google Gemini · 24/7 AI Reception for {clinicInfo.name || 'SmileVerse Dental'}
      </footer>
    </div>
  );
}

export default AIReceptionist;