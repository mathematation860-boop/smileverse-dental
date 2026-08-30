import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

const OUTCOME_LABELS = {
  unknown: 'In progress / unresolved',
  appointment_booked: 'Appointment booked',
  appointment_cancelled: 'Appointment cancelled',
  appointment_rescheduled: 'Appointment rescheduled',
  human_handoff: 'Transferred to staff',
  emergency: 'Emergency',
  faq_only: 'Questions answered',
  abandoned: 'Abandoned',
};

function formatDuration(seconds) {
  if (typeof seconds !== 'number') return '—';
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export default function CallHistoryPage() {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getCallHistory()
      .then((result) => !cancelled && setCalls(result))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!calls) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Call History</h1>
          <p>{calls.length} call{calls.length === 1 ? '' : 's'} recorded</p>
        </div>
      </div>

      <div className="admin-card">
        {calls.length === 0 ? (
          <EmptyState>No calls yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>From</th>
                  <th>Status</th>
                  <th>Outcome</th>
                  <th>Duration</th>
                  <th>Turns</th>
                  <th>Mode</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.startedAt).toLocaleString()}</td>
                    <td>{c.fromNumber || '—'}</td>
                    <td>
                      <span className={`admin-badge admin-badge-${c.status === 'completed' ? 'confirmed' : c.status === 'failed' ? 'cancelled' : 'pending'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td>
                      {c.emergencyDetected && <span className="admin-badge admin-badge-life_threatening" style={{ marginRight: 6 }}>Emergency</span>}
                      {OUTCOME_LABELS[c.outcome] || c.outcome}
                    </td>
                    <td>{formatDuration(c.durationSeconds)}</td>
                    <td>{c.turnCount}</td>
                    <td>{c.demoMode ? 'Demo' : 'Live'}</td>
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
