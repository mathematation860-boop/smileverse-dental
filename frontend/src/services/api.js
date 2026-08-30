/**
 * Central API client. Every backend call in the app goes through here —
 * components never build fetch() calls or URLs themselves. This is also
 * the one place that would need to change if the backend's base URL or
 * auth scheme changes later.
 */

import { PRACTICE_ID } from '../config/practiceId';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', 'X-Practice-Id': PRACTICE_ID },
    ...options,
  });
  if (!res.ok) {
    let details = '';
    try {
      const body = await res.json();
      details = body.error || body.details || '';
    } catch (e) {
      // ignore — no JSON body
    }
    throw new Error(details || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  health: () => request('/api/health'),
  getPracticeConfig: () => request('/api/practice-config'),
  getClinicInfo: () => request('/api/clinic-info'),
  getFaqs: () => request('/api/faqs'),
  getInsuranceInfo: () => request('/api/insurance'),
  checkInsurance: (provider) =>
    request('/api/insurance/check', { method: 'POST', body: JSON.stringify({ provider }) }),

  sendChatMessage: ({ conversationId, message }) =>
    request('/api/chat', { method: 'POST', body: JSON.stringify({ conversationId, message }) }),

  getAvailableDates: (count = 14) => request(`/api/availability/dates?count=${count}`),
  getAvailability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),

  bookAppointment: (payload) =>
    request('/api/appointments', { method: 'POST', body: JSON.stringify(payload) }),
  rescheduleAppointment: (id, payload) =>
    request(`/api/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancelAppointment: (id, payload = {}) =>
    request(`/api/appointments/${id}`, { method: 'DELETE', body: JSON.stringify(payload) }),
  searchAppointmentsByPhone: (phone) => request(`/api/appointments/search?phone=${encodeURIComponent(phone)}`),
  getAllAppointments: () => request('/api/appointments'),

  saveLead: (payload) => request('/api/leads', { method: 'POST', body: JSON.stringify(payload) }),
  getAllLeads: () => request('/api/leads'),

  requestHandoff: (payload) => request('/api/handoff', { method: 'POST', body: JSON.stringify(payload) }),

  trackEvent: (payload) => request('/api/analytics/event', { method: 'POST', body: JSON.stringify(payload) }),
};

export default api;
