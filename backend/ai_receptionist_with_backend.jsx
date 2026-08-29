import React, { useState, useRef, useEffect } from 'react';

const AIReceptionist = () => {
  const [conversationId] = useState(`conv_${Date.now()}`);
  const [messages, setMessages] = useState([
    { 
      id: 1, 
      role: 'assistant', 
      content: 'السلام علیکم! 👋 SmileVerse Dental میں خوش آمدید۔\n\nHi there! 👋 Welcome to SmileVerse Dental. I can help you with:\n• Appointment booking\n• Questions about services\n• Pricing information\n• Contact details' 
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [leads, setLeads] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [apiStatus, setApiStatus] = useState('checking');
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '', message: '' });
  const messagesEndRef = useRef(null);

  const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

  // Check API Health on Mount
  useEffect(() => {
    checkApiHealth();
  }, []);

  const checkApiHealth = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        setApiStatus('connected');
      } else {
        setApiStatus('error');
      }
    } catch (error) {
      console.error('API Health Check Failed:', error);
      setApiStatus('error');
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Send Message to Backend
  const sendMessage = async () => {
    if (!inputValue.trim()) return;
    if (apiStatus !== 'connected') {
      alert('API is not connected. Please check your backend server.');
      return;
    }

    const userMessage = { id: Date.now(), role: 'user', content: inputValue };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: conversationId,
          message: inputValue,
          history: messages.map(m => ({
            role: m.role,
            content: m.content
          }))
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setMessages(prev => [...prev, { 
          id: Date.now() + 1, 
          role: 'assistant', 
          content: data.message 
        }]);
      } else {
        setMessages(prev => [...prev, { 
          id: Date.now() + 1, 
          role: 'assistant', 
          content: 'معافی چاہتا ہوں، کوئی مسئلہ ہو گیا۔\n\nSorry, something went wrong. Please try again.' 
        }]);
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, { 
        id: Date.now() + 1, 
        role: 'assistant', 
        content: 'Backend سے رابطہ نہیں ہو سکا۔\n\nCouldn\'t connect to server. Make sure backend is running on http://localhost:5000' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLeadSubmit = async () => {
    if (!leadForm.name || !leadForm.phone) {
      alert('Please enter name and phone');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(leadForm)
      });

      const data = await response.json();
      
      if (data.success) {
        setLeads(prev => [...prev, { 
          ...leadForm, 
          id: Date.now(), 
          date: new Date().toLocaleDateString() 
        }]);
        setMessages(prev => [...prev, { 
          id: Date.now(), 
          role: 'assistant', 
          content: `شکریہ ${leadForm.name}! ہم نے آپ کی معلومات محفوظ کر دیں۔\n\nThank you ${leadForm.name}! We\'ve saved your information.` 
        }]);
        setLeadForm({ name: '', email: '', phone: '', message: '' });
        setShowLeadForm(false);
      }
    } catch (error) {
      alert('Failed to save lead');
    }
  };

  const bookAppointment = async () => {
    const today = new Date();
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Demo Patient',
          phone: '555-0123',
          service: 'Cleaning',
          date: today.toISOString().split('T')[0],
          time: '10:00 AM'
        })
      });

      const data = await response.json();
      
      if (data.success) {
        setAppointments(prev => [...prev, data.data]);
        setMessages(prev => [...prev, { 
          id: Date.now(), 
          role: 'assistant', 
          content: `آپ کی ملاقات مکمل ہو گئی! 📅\n\nYour appointment has been booked!\nDate: ${today.toLocaleDateString()}\nTime: 10:00 AM\nService: Cleaning` 
        }]);
      }
    } catch (error) {
      alert('Failed to book appointment');
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* Header with API Status */}
        <div style={{ 
          backgroundColor: '#2563eb', 
          color: 'white', 
          padding: '30px', 
          borderRadius: '10px', 
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{ margin: '0 0 10px 0', fontSize: '32px' }}>😁 SmileVerse Dental</h1>
            <p style={{ margin: '0', fontSize: '16px', opacity: 0.9 }}>AI Powered Reception System | Real Claude API</p>
          </div>
          <div style={{
            padding: '12px 20px',
            backgroundColor: apiStatus === 'connected' ? '#10b981' : '#ef4444',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 'bold',
            textAlign: 'center'
          }}>
            {apiStatus === 'connected' ? '✅ API Connected' : '❌ API Error'}
          </div>
        </div>

        {/* Main Content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '20px' }}>
          
          {/* Chat Section */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '10px', 
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)', 
            display: 'flex', 
            flexDirection: 'column', 
            height: '500px' 
          }}>
            {/* Messages */}
            <div style={{ 
              flex: 1, 
              overflowY: 'auto', 
              padding: '20px', 
              borderBottom: '1px solid #e5e7eb' 
            }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ 
                  marginBottom: '15px', 
                  display: 'flex', 
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' 
                }}>
                  <div style={{
                    backgroundColor: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
                    color: msg.role === 'user' ? 'white' : 'black',
                    padding: '12px 15px',
                    borderRadius: '10px',
                    maxWidth: '70%',
                    wordWrap: 'break-word',
                    fontSize: '14px',
                    lineHeight: '1.5',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div style={{ color: '#6b7280', fontSize: '14px', fontStyle: 'italic' }}>
                  🤖 Claude is typing...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '15px', display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type your message (Urdu/English)..."
                disabled={isLoading || apiStatus !== 'connected'}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '5px',
                  fontSize: '14px',
                  fontFamily: 'Arial'
                }}
              />
              <button
                onClick={sendMessage}
                disabled={isLoading || apiStatus !== 'connected'}
                style={{
                  padding: '10px 20px',
                  backgroundColor: isLoading || apiStatus !== 'connected' ? '#d1d5db' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: isLoading || apiStatus !== 'connected' ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                {isLoading ? '⏳' : '📤'}
              </button>
            </div>
          </div>

          {/* Sidebar - Quick Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <button
              onClick={bookAppointment}
              disabled={apiStatus !== 'connected'}
              style={{
                padding: '15px',
                backgroundColor: apiStatus !== 'connected' ? '#d1d5db' : '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: apiStatus !== 'connected' ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                textAlign: 'center'
              }}
            >
              📅 Book Now
            </button>

            <button
              onClick={() => setShowLeadForm(!showLeadForm)}
              style={{
                padding: '15px',
                backgroundColor: '#f59e0b',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
                textAlign: 'center'
              }}
            >
              💌 Save Info
            </button>

            {showLeadForm && (
              <div style={{ backgroundColor: '#fff9e6', padding: '15px', borderRadius: '8px', border: '1px solid #fcd34d' }}>
                <input
                  type="text"
                  placeholder="Name / نام"
                  value={leadForm.name}
                  onChange={(e) => setLeadForm({...leadForm, name: e.target.value})}
                  style={{ width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={leadForm.email}
                  onChange={(e) => setLeadForm({...leadForm, email: e.target.value})}
                  style={{ width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
                <input
                  type="tel"
                  placeholder="Phone / فون"
                  value={leadForm.phone}
                  onChange={(e) => setLeadForm({...leadForm, phone: e.target.value})}
                  style={{ width: '100%', padding: '8px', marginBottom: '8px', borderRadius: '4px', border: '1px solid #d1d5db', boxSizing: 'border-box' }}
                />
                <button
                  onClick={handleLeadSubmit}
                  style={{
                    width: '100%',
                    padding: '8px',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Services Card */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: '15px', 
          marginTop: '20px' 
        }}>
          
          {/* Services */}
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: '0', color: '#2563eb' }}>🦷 Services</h3>
            <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
              <p><strong>Cleaning:</strong> $150 (45 mins)</p>
              <p><strong>Root Canal:</strong> $800 (90 mins)</p>
              <p><strong>Whitening:</strong> $200 (60 mins)</p>
              <p><strong>Filling:</strong> $250 (45 mins)</p>
              <p><strong>Extraction:</strong> $300 (30 mins)</p>
              <p><strong>Crown:</strong> $1200 (120 mins)</p>
            </div>
          </div>

          {/* Contact Info */}
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: '0', color: '#2563eb' }}>📞 Contact</h3>
            <p style={{ margin: '8px 0', fontSize: '14px' }}><strong>Phone:</strong><br/> +1-555-SMILE-01</p>
            <p style={{ margin: '8px 0', fontSize: '14px' }}><strong>Email:</strong><br/> info@smileverse.com</p>
            <p style={{ margin: '8px 0', fontSize: '14px' }}><strong>Hours:</strong><br/> Mon-Fri: 9 AM - 5 PM</p>
          </div>

          {/* Stats */}
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: '0', color: '#2563eb' }}>📊 Stats</h3>
            <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#f3f4f6', borderRadius: '5px' }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280' }}>Messages</p>
              <p style={{ margin: '5px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: '#2563eb' }}>{messages.length}</p>
            </div>
            <div style={{ marginBottom: '12px', padding: '10px', backgroundColor: '#f3f4f6', borderRadius: '5px' }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280' }}>Leads</p>
              <p style={{ margin: '5px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>{leads.length}</p>
            </div>
            <div style={{ padding: '10px', backgroundColor: '#f3f4f6', borderRadius: '5px' }}>
              <p style={{ margin: '0', fontSize: '12px', color: '#6b7280' }}>Appointments</p>
              <p style={{ margin: '5px 0 0 0', fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>{appointments.length}</p>
            </div>
          </div>
        </div>

        {/* Leads List */}
        {leads.length > 0 && (
          <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '10px', marginTop: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: '0', color: '#2563eb' }}>💌 Captured Leads</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: '10px', fontSize: '14px', fontWeight: 'bold' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontSize: '14px', fontWeight: 'bold' }}>Phone</th>
                  <th style={{ textAlign: 'left', padding: '10px', fontSize: '14px', fontWeight: 'bold' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr key={lead.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '10px', fontSize: '14px' }}>{lead.name}</td>
                    <td style={{ padding: '10px', fontSize: '14px' }}>{lead.phone}</td>
                    <td style={{ padding: '10px', fontSize: '14px' }}>{lead.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: '30px', padding: '20px', backgroundColor: '#f3f4f6', borderRadius: '10px', textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
          <p style={{ margin: '0' }}>🤖 Powered by Claude Opus 4.1 | 24/7 Support Available</p>
          <p style={{ margin: '10px 0 0 0' }}>Backend: {API_BASE_URL}</p>
        </div>
      </div>
    </div>
  );
};

export default AIReceptionist;
