import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

const STATUS_CLASS = { Confirmed: 'admin-badge-confirmed', Rescheduled: 'admin-badge-rescheduled', Cancelled: 'admin-badge-cancelled' };

function RescheduleForm({ appointment, onCancel, onSubmit }) {
  const [date, setDate] = useState(appointment.date);
  const [time, setTime] = useState(appointment.time);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSubmit(date, time);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-modal-backdrop" onClick={onCancel}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Reschedule appointment</h2>
        {error && <div className="admin-alert admin-alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="admin-field">
            <label>Date (YYYY-MM-DD)</label>
            <input value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="admin-field">
            <label>Time</label>
            <input value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="admin-btn admin-btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save new time'}
            </button>
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppointmentsPage() {
  const [appointments, setAppointments] = useState(null);
  const [error, setError] = useState('');
  const [rescheduling, setRescheduling] = useState(null);
  const [actionError, setActionError] = useState('');

  function load() {
    adminApi
      .getAppointments()
      .then(setAppointments)
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function handleCancel(appointment) {
    if (!window.confirm(`Cancel the ${appointment.service} appointment for ${appointment.name} on ${appointment.date}?`)) return;
    setActionError('');
    try {
      await adminApi.cancelAppointment(appointment._id);
      load();
    } catch (err) {
      setActionError(err.message);
    }
  }

  async function handleReschedule(date, time) {
    await adminApi.rescheduleAppointment(rescheduling._id, { date, time });
    setRescheduling(null);
    load();
  }

  if (error) return <ErrorState message={error} />;
  if (!appointments) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Appointments</h1>
          <p>{appointments.length} total</p>
        </div>
      </div>

      {actionError && <div className="admin-alert admin-alert-error">{actionError}</div>}

      <div className="admin-card">
        {appointments.length === 0 ? (
          <EmptyState>No appointments yet.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Service</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Source</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a._id}>
                    <td>{a.name}<br /><span style={{ color: 'var(--sv-text-muted)', fontSize: 12 }}>{a.phone}</span></td>
                    <td>{a.service}</td>
                    <td>{a.date}</td>
                    <td>{a.time}</td>
                    <td><span className={`admin-badge ${STATUS_CLASS[a.status] || ''}`}>{a.status}</span></td>
                    <td>{a.calendarProvider === 'google' ? 'Google Calendar' : 'Demo'}</td>
                    <td>
                      {a.status !== 'Cancelled' && (
                        <div className="admin-row-actions">
                          <button className="admin-btn admin-btn-secondary" onClick={() => setRescheduling(a)}>
                            Reschedule
                          </button>
                          <button className="admin-btn admin-btn-danger" onClick={() => handleCancel(a)}>
                            Cancel
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rescheduling && (
        <RescheduleForm appointment={rescheduling} onCancel={() => setRescheduling(null)} onSubmit={handleReschedule} />
      )}
    </div>
  );
}
