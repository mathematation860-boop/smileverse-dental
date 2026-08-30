import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

const APPT_EVENT_LABEL = {
  appointment_booked: 'Booked',
  appointment_rescheduled: 'Rescheduled',
  appointment_cancelled: 'Cancelled',
};

function ConversationDetailModal({ conversationId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getConversation(conversationId).then(setDetail).catch((err) => setError(err.message));
  }, [conversationId]);

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Conversation</h2>
        {error && <ErrorState message={error} />}
        {!detail && !error && <LoadingState />}
        {detail && (
          <div>
            <p style={{ fontSize: 13, color: 'var(--sv-text-muted)' }}>
              Started {new Date(detail.createdAt).toLocaleString()} · Urgency: {detail.slots.urgency || 'none'} · Language:{' '}
              {detail.slots.language || 'en'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto', margin: '16px 0' }}>
              {detail.history.map((m, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                    background: m.role === 'user' ? 'var(--sv-coral-light)' : 'var(--sv-cream-tint)',
                    borderRadius: 12,
                    padding: '8px 12px',
                    maxWidth: '85%',
                    fontSize: 13.5,
                  }}
                >
                  {m.content}
                </div>
              ))}
            </div>
            {detail.handoffs.length > 0 && (
              <div className="admin-alert admin-alert-info">
                {detail.handoffs.length} human handoff request{detail.handoffs.length === 1 ? '' : 's'} tied to this
                conversation.
              </div>
            )}
          </div>
        )}
        <div className="admin-form-actions">
          <button className="admin-btn admin-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    adminApi.getConversations().then(setConversations).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!conversations) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Conversations</h1>
          <p>{conversations.length} conversation{conversations.length === 1 ? '' : 's'} this session</p>
        </div>
      </div>

      <div className="admin-card">
        {conversations.length === 0 ? (
          <EmptyState>No conversations yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Messages</th>
                  <th>Contact captured</th>
                  <th>Urgency</th>
                  <th>Handoff</th>
                  <th>Appointment outcome</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.conversationId}>
                    <td>{new Date(c.createdAt).toLocaleString()}</td>
                    <td>{c.messageCount}</td>
                    <td>{c.hasContactInfo ? 'Yes' : 'No'}</td>
                    <td>
                      {c.urgency !== 'none' ? <span className={`admin-badge admin-badge-${c.urgency}`}>{c.urgency}</span> : '—'}
                    </td>
                    <td>{c.handoffRequested ? 'Requested' : '—'}</td>
                    <td>{c.appointmentEvent ? APPT_EVENT_LABEL[c.appointmentEvent] || c.appointmentEvent : '—'}</td>
                    <td>
                      <button className="admin-btn admin-btn-secondary" onClick={() => setOpenId(c.conversationId)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openId && <ConversationDetailModal conversationId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
