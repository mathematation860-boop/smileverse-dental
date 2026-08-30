import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

const STATUS_OPTIONS = ['pending', 'assigned', 'resolved'];

export default function HandoffsPage() {
  const [handoffs, setHandoffs] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');

  function load() {
    adminApi.getHandoffs().then(setHandoffs).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleStatusChange(id, status) {
    setActionError('');
    try {
      await adminApi.updateHandoffStatus(id, status);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!handoffs) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Human Handoffs</h1>
          <p>{handoffs.filter((h) => h.status === 'pending').length} pending</p>
        </div>
      </div>

      {actionError && <div className="admin-alert admin-alert-error">{actionError}</div>}

      <div className="admin-card">
        {handoffs.length === 0 ? (
          <EmptyState>No handoff requests yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Reason</th>
                  <th>Urgency</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Message</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {handoffs.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.createdAt).toLocaleString()}</td>
                    <td>{h.reason}</td>
                    <td>
                      <span className={`admin-badge admin-badge-${h.urgency}`}>{h.urgency}</span>
                    </td>
                    <td>{h.name || '—'}</td>
                    <td>{h.phone || '—'}</td>
                    <td style={{ maxWidth: 240 }}>{h.message || '—'}</td>
                    <td>
                      <select
                        value={h.status}
                        onChange={(e) => handleStatusChange(h.id, e.target.value)}
                        style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sv-border)' }}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
