import React, { useEffect, useRef, useState } from 'react';
import api from '../services/api';
import { trackEvent, EVENTS } from '../services/analytics';
import { useLanguage } from '../i18n/LanguageContext';
import HandoffPanel from './HandoffPanel';

const WELCOME_EN =
  "Hi, I'm your AI dental receptionist at SmileVerse Dental — available 24/7. " +
  "I can answer questions, book or change appointments, check insurance, or connect you with our team. How can I help today?";
const WELCOME_UR =
  'السلام علیکم، میں SmileVerse Dental کا AI ریسیپشنسٹ ہوں — 24/7 دستیاب۔ ' +
  'میں سوالات کے جواب دے سکتا ہوں، اپائنٹمنٹ بنا یا تبدیل کر سکتا ہوں، انشورنس چیک کر سکتا ہوں، یا آپ کو ہماری ٹیم سے ملوا سکتا ہوں۔ آج کیسے مدد کروں؟';

function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (err) {
    return '';
  }
}

function guessLoadingLabel(text, t) {
  const lower = text.toLowerCase();
  if (/(book|appointment|schedule)/.test(lower)) return t.chat.loadingBooking;
  if (/(reschedul|cancel|change)/.test(lower)) return t.chat.loadingLookup;
  if (/(available|time|slot|open)/.test(lower)) return t.chat.loadingAvailability;
  return t.chat.loadingGeneral;
}

function ChatPanel({
  conversationId,
  practiceConfig,
  onMessageCountChange,
  onOpenBooking,
  onOpenFaq,
  onOpenInsurance,
  scrollTargetRef,
  externalTrigger,
}) {
  const { t, language } = useLanguage();
  const [messages, setMessages] = useState(() => [
    { role: 'assistant', content: language === 'ur' ? WELCOME_UR : WELCOME_EN, timestamp: new Date().toISOString() },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [showHandoff, setShowHandoff] = useState(false);
  const [handoffReason, setHandoffReason] = useState('uncertain');
  const messagesEndRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    onMessageCountChange && onMessageCountChange(messages.length);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      trackEvent(EVENTS.CONVERSATION_STARTED, conversationId, {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Let the Hero's "Talk to AI Receptionist" button send a starter prompt.
  useEffect(() => {
    if (externalTrigger) sendMessage(externalTrigger);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTrigger]);

  const sendMessage = async (textOverride) => {
    const text = (textOverride ?? inputValue).trim();
    if (!text || isLoading) return;

    const userMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setLoadingLabel(guessLoadingLabel(text, t));

    try {
      const data = await api.sendChatMessage({ conversationId, message: text });

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply || data.message || t.chat.errorReply,
          timestamp: new Date().toISOString(),
          urgency: data.urgency,
          intent: data.intent,
          suggestedActions: data.suggestedActions || [],
          entities: data.entities || {},
        },
      ]);

      if (data.intent === 'human_handoff') {
        setHandoffReason('uncertain');
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: t.chat.errorReply, timestamp: new Date().toISOString(), isError: true },
      ]);
    } finally {
      setIsLoading(false);
      setLoadingLabel('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleAction = (action, msg) => {
    if (action === 'book_appointment') {
      onOpenBooking({
        serviceId: msg.entities?.serviceId,
        datePreference: msg.entities?.datePreference,
        patientType: msg.entities?.patientType,
      });
    } else if (action === 'urgent_appointment') {
      onOpenBooking({ serviceId: 'emergency', datePreference: msg.entities?.datePreference, urgent: true });
    } else if (action === 'talk_to_human') {
      setHandoffReason(msg.intent === 'emergency' ? 'urgent' : 'uncertain');
      setShowHandoff(true);
    } else if (action === 'show_faq') {
      onOpenFaq();
    } else if (action === 'show_insurance') {
      onOpenInsurance();
    }
  };

  return (
    <section className="sv-chat-panel" ref={scrollTargetRef}>
      <div className="sv-quick-actions-bar">
        <button className="sv-chip" onClick={() => onOpenBooking({})}>📅 {t.quickActions.book}</button>
        <button className="sv-chip" onClick={() => sendMessage('What are your prices?')}>💲 {t.quickActions.prices}</button>
        <button className="sv-chip" onClick={() => sendMessage('What are your hours?')}>🕐 {t.quickActions.hours}</button>
        <button className="sv-chip" onClick={() => sendMessage('Where are you located?')}>📍 {t.quickActions.location}</button>
        <button className="sv-chip" onClick={onOpenInsurance}>🛡️ {t.quickActions.insurance}</button>
        <button className="sv-chip sv-chip-emergency" onClick={() => sendMessage('I have a dental emergency')}>🚨 {t.quickActions.emergency}</button>
        <button className="sv-chip" onClick={() => setShowHandoff(true)}>💁 {t.quickActions.human}</button>
      </div>

      <div className="sv-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`sv-message-row ${msg.role === 'user' ? 'sv-row-user' : 'sv-row-bot'}`}>
            {msg.role !== 'user' && <div className="sv-avatar">🦷</div>}
            <div className="sv-bubble-wrap">
              <div
                className={`sv-bubble ${msg.role === 'user' ? 'sv-bubble-user' : 'sv-bubble-bot'} ${
                  msg.urgency === 'life_threatening' ? 'sv-bubble-danger' : ''
                }`}
              >
                {msg.content.split('\n').map((line, i, arr) => (
                  <React.Fragment key={i}>
                    {line}
                    {i < arr.length - 1 && <br />}
                  </React.Fragment>
                ))}
              </div>
              {msg.timestamp && <span className="sv-bubble-timestamp">{formatTimestamp(msg.timestamp)}</span>}
              {msg.role === 'assistant' && msg.suggestedActions && msg.suggestedActions.length > 0 && (
                <div className="sv-message-actions">
                  {msg.suggestedActions
                    .filter((a) => a !== 'none')
                    .map((action) => (
                      <button
                        key={action}
                        type="button"
                        className={`sv-inline-action-btn ${action === 'urgent_appointment' ? 'sv-inline-action-urgent' : ''}`}
                        onClick={() => handleAction(action, msg)}
                      >
                        {action === 'book_appointment' && `📅 ${t.hero.ctaBook}`}
                        {action === 'urgent_appointment' && `🚨 ${t.chat.urgentButton}`}
                        {action === 'talk_to_human' && `💁 ${t.quickActions.human}`}
                        {action === 'show_faq' && `❓ ${t.faq.title}`}
                        {action === 'show_insurance' && `🛡️ ${t.quickActions.insurance}`}
                        {action === 'show_prices' && `💲 ${t.quickActions.prices}`}
                      </button>
                    ))}
                </div>
              )}
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
              {loadingLabel && <span className="sv-loading-label">{loadingLabel}</span>}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {showHandoff && (
        <div className="sv-inline-handoff">
          <HandoffPanel
            practiceConfig={practiceConfig}
            conversationId={conversationId}
            reason={handoffReason}
            onClose={() => setShowHandoff(false)}
          />
        </div>
      )}

      <div className="sv-input-bar">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={t.chat.placeholder}
          disabled={isLoading}
        />
        <button className="sv-send-btn" onClick={() => sendMessage()} disabled={isLoading} aria-label={t.chat.send}>
          ➤
        </button>
      </div>
    </section>
  );
}

export default ChatPanel;
