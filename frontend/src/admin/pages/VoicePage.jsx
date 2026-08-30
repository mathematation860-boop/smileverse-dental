import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState } from '../components/StatusStates';

const STAT_FIELDS = [
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'answeredCalls', label: 'Answered Calls' },
  { key: 'transferredCalls', label: 'Transferred to Staff' },
  { key: 'missedCalls', label: 'Missed Calls' },
  { key: 'appointmentConversions', label: 'Appointments Booked' },
  { key: 'avgDurationSeconds', label: 'Avg. Call Duration', render: (v) => `${Math.floor(v / 60)}m ${v % 60}s` },
];

export default function VoicePage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getVoiceStatus()
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
          <h1>Voice Receptionist</h1>
          <p>Phone-in AI receptionist — status and call performance.</p>
        </div>
      </div>

      <div className={`admin-alert ${data.enabled ? 'admin-alert-success' : 'admin-alert-info'}`}>
        {data.enabled ? (
          <>
            <strong>Voice is live.</strong> Incoming calls to {data.phoneNumber} are answered by the AI receptionist via{' '}
            {data.providerName}.
          </>
        ) : (
          <>
            <strong>Voice is running in demo mode.</strong>{' '}
            {data.phoneNumber
              ? `A phone number (${data.phoneNumber}) is configured, but this practice's provider isn't fully set up yet, or demo mode is still on.`
              : 'No phone number is configured for this practice yet — no calls can come in until one is set up.'}{' '}
            No real telephone calls are being received. See the README for what's required to go live.
          </>
        )}
      </div>

      <div className="admin-alert admin-alert-info">
        <strong>Emergency safety is always on.</strong> The deterministic emergency classifier runs on every call before
        anything else and cannot be turned off from this dashboard.
      </div>

      <div className="admin-grid">
        {STAT_FIELDS.map((field) => (
          <div className="admin-stat-card" key={field.key}>
            <div className="admin-stat-label">{field.label}</div>
            <div className="admin-stat-value">{field.render ? field.render(data.stats[field.key]) : data.stats[field.key]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
