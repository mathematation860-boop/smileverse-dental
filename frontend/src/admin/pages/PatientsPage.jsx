import React, { useEffect, useState } from 'react';
import adminApi from '../services/adminApi';
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates';

export default function PatientsPage() {
  const [patients, setPatients] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.getPatients().then(setPatients).catch((err) => setError(err.message));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!patients) return <LoadingState />;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1>Patients</h1>
          <p>Derived from appointment history — {patients.length} patient{patients.length === 1 ? '' : 's'}</p>
        </div>
      </div>
      <div className="admin-card">
        {patients.length === 0 ? (
          <EmptyState>No patients yet — they'll appear here once appointments are booked.</EmptyState>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Total Visits</th>
                  <th>Upcoming</th>
                  <th>Last Visit</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name || '—'}</td>
                    <td>{p.phone || '—'}</td>
                    <td>{p.email || '—'}</td>
                    <td>{p.appointmentCount}</td>
                    <td>{p.upcomingCount}</td>
                    <td>{p.lastVisitDate || '—'}</td>
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
