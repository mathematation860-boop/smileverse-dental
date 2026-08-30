import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../AdminAuthContext';

const NAV_ITEMS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/appointments', label: 'Appointments' },
  { to: '/admin/patients', label: 'Patients' },
  { to: '/admin/conversations', label: 'Conversations' },
  { to: '/admin/handoffs', label: 'Handoffs' },
  { to: '/admin/analytics', label: 'Analytics' },
  { to: '/admin/settings', label: 'Practice Settings' },
  { to: '/admin/calendar', label: 'Calendar' },
];

export default function AdminLayout() {
  const { admin, logout } = useAdminAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-brand">
          SmileVerse
          <span className="admin-demo-pill">Admin</span>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
        <div className="admin-nav-divider" />
        <div className="admin-nav-footer">
          {admin && (
            <div className="admin-nav-admin-name">
              {admin.name} · {admin.email}
              {admin.role === 'super_admin' && <span className="admin-demo-pill" style={{ marginLeft: 6 }}>Super Admin</span>}
            </div>
          )}
          <button type="button" className="admin-nav-link" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer' }} onClick={handleLogout}>
            Logout
          </button>
        </div>
      </aside>
      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
