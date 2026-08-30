import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, DemoModeBanner } from '../components/StatusStates';

export default function CalendarPage() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);

  function load() {
    adminApi.getCalendarStatus().then(setStatus).catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Google Calendar? Real availability checks will fail until you reconnect (or Demo Mode is enabled).')) return;
    setDisconnecting(true);
    try {
      await adminApi.disconnectCalendar();
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!status) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Calendar</h1>
          <p>Connect your practice's Google Calendar for real availability and bookings.</p>
        </div>
      </div>

      <DemoModeBanner demoMode={status.demoMode} />

      <div className="admin-card">
        <h2>Connection status</h2>
        <p>
          <span className={`admin-badge ${status.connected ? 'admin-badge-connected' : 'admin-badge-not-connected'}`}>
            {status.connected ? 'Connected' : 'Not connected'}
          </span>
        </p>
        {status.connected && (
          <p style={{ fontSize: 14, color: 'var(--sv-text-muted)' }}>
            Connected as <strong>{status.connectedEmail || 'unknown account'}</strong> (calendar: {status.calendarId})
          </p>
        )}

        {status.demoMode && (
          <div className="admin-alert admin-alert-info">
            Demo Mode is on, so appointment booking uses the simulated calendar regardless of this connection. Connecting a
            real calendar here prepares it for when Demo Mode is turned off for this practice.
          </div>
        )}

        <div className="admin-form-actions">
          {!status.connected ? (
            <a className="admin-btn admin-btn-primary" href={adminApi.calendarOauthStartUrl()}>
              Connect Google Calendar
            </a>
          ) : (
            <button className="admin-btn admin-btn-danger" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect Google Calendar'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
