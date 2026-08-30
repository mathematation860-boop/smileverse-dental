import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

const TYPE_LABELS = {
  appointment_confirmation: 'Appointment confirmation',
  appointment_rescheduled: 'Reschedule confirmation',
  appointment_cancelled: 'Cancellation confirmation',
  appointment_reminder: 'Reminder',
  human_handoff: 'Staff handoff alert',
  emergency_alert: 'Emergency alert',
};

// 'simulated' reuses the neutral/pending badge — it is NOT a failure, but
// it must never look identical to a genuinely delivered ('sent') message
// (Phase 5 spec §3: demo mode must clearly distinguish simulated from real).
const STATUS_BADGE = { sent: 'confirmed', failed: 'cancelled', simulated: 'pending' };
const STATUS_LABEL = { sent: 'Sent', failed: 'Failed', simulated: 'Simulated (demo)' };

export default function NotificationHistoryPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getNotificationHistory()
      .then((result) => !cancelled && setRows(result))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!rows) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Notification History</h1>
          <p>{rows.length} notification{rows.length === 1 ? '' : 's'} recorded</p>
        </div>
      </div>

      <div className="admin-card">
        {rows.length === 0 ? (
          <EmptyState>No notifications yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>Channel</th>
                  <th>To</th>
                  <th>Status</th>
                  <th>Provider</th>
                  <th>Failure reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.createdAt).toLocaleString()}</td>
                    <td>{TYPE_LABELS[r.type] || r.type}</td>
                    <td>{r.channel === 'sms' ? 'SMS' : 'Email'}</td>
                    <td>{r.destinationMasked || '—'}</td>
                    <td>
                      <span className={`admin-badge admin-badge-${STATUS_BADGE[r.status] || 'pending'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    <td>{r.provider || '—'}</td>
                    <td>{r.failureReason || '—'}</td>
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
