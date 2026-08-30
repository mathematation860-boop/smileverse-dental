/**
 * Admin API client — separate from ../../services/api.js on purpose.
 *
 * The public api.js never sends cookies (the public receptionist has no
 * session), so rather than risk changing its behavior, every admin call
 * goes through its own `request()` here that always sends
 * `credentials: 'include'` — required for the httpOnly admin session
 * cookie (see backend/routes/adminAuth.js) to actually be sent/received
 * cross-origin between this dashboard and the API.
 */

import { PRACTICE_ID } from '../../config/practiceId';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Practice-Id': PRACTICE_ID },
    credentials: 'include',
    ...options,
  });

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    // no/invalid JSON body — fine for a 204 or a network-level failure page
  }

  if (!res.ok) {
    const error = new Error((body && (body.error || body.details?.join?.(', '))) || `Request failed (${res.status})`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

export const adminApi = {
  login: (email, password) => request('/api/admin/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/api/admin/logout', { method: 'POST' }),
  me: () => request('/api/admin/me'),

  getDashboardOverview: () => request('/api/admin/dashboard/overview'),
  getAnalytics: () => request('/api/admin/analytics'),
  getPatients: () => request('/api/admin/patients'),

  getAppointments: () => request('/api/admin/appointments'),
  rescheduleAppointment: (id, payload) => request(`/api/admin/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancelAppointment: (id) => request(`/api/admin/appointments/${id}`, { method: 'DELETE' }),

  getConversations: () => request('/api/admin/conversations'),
  getConversation: (id) => request(`/api/admin/conversations/${encodeURIComponent(id)}`),

  getHandoffs: () => request('/api/admin/handoffs'),
  updateHandoffStatus: (id, status) => request(`/api/admin/handoffs/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  getSettings: () => request('/api/admin/settings'),
  updateSettings: (patch) => request('/api/admin/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  getAiConfig: () => request('/api/admin/ai-config'),
  updateAiConfig: (patch) => request('/api/admin/ai-config', { method: 'PUT', body: JSON.stringify(patch) }),

  getCalendarStatus: () => request('/api/admin/calendar/status'),
  disconnectCalendar: () => request('/api/admin/calendar/disconnect', { method: 'POST' }),
  calendarOauthStartUrl: () => `${API_BASE_URL}/api/admin/calendar/oauth/start`,

  // Phase 4 — voice receptionist status/stats and call history.
  getVoiceStatus: () => request('/api/admin/voice'),
  getCallHistory: () => request('/api/admin/call-history'),

  // Phase 5 — SMS/email notification status, history, and settings.
  getNotificationsStatus: () => request('/api/admin/notifications'),
  getNotificationHistory: () => request('/api/admin/notification-history'),
  getNotificationSettings: () => request('/api/admin/notification-settings'),
  updateNotificationSettings: (patch) => request('/api/admin/notification-settings', { method: 'PUT', body: JSON.stringify(patch) }),

  // Phase 6 — Open Dental PMS status, connection test, and ID-mapping settings.
  getPmsStatus: () => request('/api/admin/pms'),
  testPmsConnection: () => request('/api/admin/pms/test-connection', { method: 'POST' }),
  getPmsSettings: () => request('/api/admin/pms-settings'),
  updatePmsSettings: (patch) => request('/api/admin/pms-settings', { method: 'PUT', body: JSON.stringify(patch) }),
};

export default adminApi;
