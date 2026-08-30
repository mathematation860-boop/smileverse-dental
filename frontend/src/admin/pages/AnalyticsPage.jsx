import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState, DemoModeBanner } from '../components/StatusStates';

const EVENT_LABELS = {
  conversation_started: 'Conversations Started',
  appointment_requested: 'Appointments Requested',
  appointment_booked: 'Appointments Booked',
  appointment_cancelled: 'Appointments Cancelled',
  appointment_rescheduled: 'Appointments Rescheduled',
  emergency_request: 'Emergency/Urgent Requests',
  human_handoff_requested: 'Human Handoffs Requested',
  unanswered_question: 'Unanswered Questions',
};

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getAnalytics().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Analytics</h1>
          <p>Event counts logged since this practice started using the AI receptionist</p>
        </div>
      </div>
      <DemoModeBanner demoMode={data.demoMode} />
      <div className="admin-card">
        {data.summary.length === 0 ? (
          <EmptyState>No events logged yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.map((row) => (
                  <tr key={row.name}>
                    <td>{EVENT_LABELS[row.name] || row.name}</td>
                    <td>{row.count}</td>
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
