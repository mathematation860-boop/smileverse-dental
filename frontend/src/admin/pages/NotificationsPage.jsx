import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState } from '../components/StatusStates';

const STAT_FIELDS = [
  { key: 'total', label: 'Total Notifications' },
  { key: 'sent', label: 'Sent (real)' },
  { key: 'simulated', label: 'Simulated (demo)' },
  { key: 'failed', label: 'Failed' },
  { key: 'smsCount', label: 'By SMS' },
  { key: 'emailCount', label: 'By Email' },
];

export default function NotificationsPage() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([adminApi.getNotificationsStatus(), adminApi.getNotificationSettings()])
      .then(([status, s]) => {
        if (cancelled) return;
        setData(status);
        setSettings(s);
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      await adminApi.updateNotificationSettings(settings);
      setSavedAt(Date.now());
      const status = await adminApi.getNotificationsStatus();
      setData(status);
    } catch (err) {
      setSaveError(err.message + (err.body?.details ? `: ${err.body.details.join('; ')}` : ''));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!data || !settings) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Notifications</h1>
          <p>SMS + email appointment confirmations, reminders, and staff alerts.</p>
        </div>
      </div>

      <div className={`admin-alert ${data.smsLive || data.emailLive ? 'admin-alert-success' : 'admin-alert-info'}`}>
        {data.demoMode ? (
          <>
            <strong>Notifications are running in demo mode.</strong> Every SMS/email is simulated — logged as "Simulated" in
            the history below, never actually delivered to a patient. No real message has been sent.
          </>
        ) : (
          <>
            <strong>SMS is {data.smsLive ? 'live' : 'not fully configured'}</strong> ({data.smsProviderName}
            {data.smsProviderConfigured ? '' : ', missing credentials'}). <strong>Email is {data.emailLive ? 'live' : 'not fully configured'}</strong> ({data.emailProviderName}
            {data.emailProviderConfigured ? '' : ', missing credentials'}).
          </>
        )}
      </div>

      <div className="admin-alert admin-alert-info">
        <strong>Emergency clinic alerts are always on.</strong> A detected medical emergency attempts to notify your practice
        by SMS/email in the background — this never delays or changes the immediate safety guidance a patient receives, and
        can't be turned off from this dashboard.
      </div>

      <div className="admin-grid">
        {STAT_FIELDS.map((field) => (
          <div className="admin-stat-card" key={field.key}>
            <div className="admin-stat-label">{field.label}</div>
            <div className="admin-stat-value">{data.stats[field.key]}</div>
          </div>
        ))}
      </div>

      <div className="admin-card">
        <h2>Settings</h2>
        <div className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
          <input
            type="checkbox"
            checked={settings.smsEnabled}
            onChange={(e) => setSettings({ ...settings, smsEnabled: e.target.checked })}
          />
          <label style={{ fontWeight: 400 }}>SMS notifications enabled</label>
        </div>
        <div className="admin-field" style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
          <input
            type="checkbox"
            checked={settings.emailEnabled}
            onChange={(e) => setSettings({ ...settings, emailEnabled: e.target.checked })}
          />
          <label style={{ fontWeight: 400 }}>Email notifications enabled</label>
        </div>
        <div className="admin-field">
          <label>Reminder lead time (hours before appointment, comma-separated)</label>
          <input
            value={(settings.reminderOffsetsHours || []).join(', ')}
            onChange={(e) =>
              setSettings({
                ...settings,
                reminderOffsetsHours: e.target.value
                  .split(',')
                  .map((s) => Number(s.trim()))
                  .filter((n) => Number.isFinite(n) && n > 0),
              })
            }
            placeholder="24"
          />
        </div>
        <div className="admin-form-actions" style={{ alignItems: 'center' }}>
          <button type="button" className="admin-btn admin-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {saveError && <span style={{ color: 'var(--sv-danger-dark)', fontSize: 13 }}>{saveError}</span>}
          {!saveError && savedAt && <span style={{ color: 'var(--sv-mint-dark)', fontSize: 13 }}>Saved.</span>}
        </div>
      </div>
    </div>
  );
}
