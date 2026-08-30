import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, DemoModeBanner } from '../components/StatusStates';

const STAT_FIELDS = [
  { key: 'today', label: "Today's Appointments", render: (data) => data.today.appointments },
  { key: 'upcomingAppointments', label: 'Upcoming Appointments' },
  { key: 'newLeads', label: 'New Leads (7d)' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'pendingHandoffs', label: 'Pending Handoffs' },
  { key: 'cancellations', label: 'Cancellations' },
  { key: 'reschedules', label: 'Reschedules' },
];

export default function DashboardOverviewPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getDashboardOverview()
      .then((result) => !cancelled && setData(result))
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!data) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Dashboard</h1>
          <p>{data.practiceName}</p>
        </div>
      </div>

      <DemoModeBanner demoMode={data.demoMode} />

      <div className="admin-grid">
        {STAT_FIELDS.map((field) => (
          <div className="admin-stat-card" key={field.key}>
            <div className="admin-stat-label">{field.label}</div>
            <div className="admin-stat-value">{field.render ? field.render(data) : data[field.key]}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <h2>Lifetime totals</h2>
        <p style={{ margin: 0, color: 'var(--sv-text-muted)', fontSize: 14 }}>
          {data.totalAppointmentsBooked} appointment{data.totalAppointmentsBooked === 1 ? '' : 's'} booked in total ·{' '}
          {data.totalLeads} lead{data.totalLeads === 1 ? '' : 's'} captured · {data.totalHandoffs} handoff request
          {data.totalHandoffs === 1 ? '' : 's'} in total.
        </p>
      </div>
    </div>
  );
}
