/**
 * Central API client. Every backend call in the app goes through here —
 * components never build fetch() calls or URLs themselves. This is also
 * the one place that would need to change if the backend's base URL or
 * auth scheme changes later.
 */

import { PRACTICE_ID } from '../config/practiceId';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  // Headers are MERGED, not replaced. Spreading `options` over a `headers`
  // key would silently drop Content-Type and X-Practice-Id the moment any
  // caller passed a header of its own.
  const { headers: extraHeaders, ...rest } = options;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', 'X-Practice-Id': PRACTICE_ID, ...(extraHeaders || {}) },
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

  // The conversation is identified by a token the SERVER issued and signed;
  // the client only ever echoes it back. Sending no token starts a new
  // conversation and the response carries the token to use from then on.
  //
  // `conversationId` is sent alongside it purely for the deployment window.
  // The frontend ships BEFORE the backend, and the old backend rejects a
  // request with no conversationId at all — so without this, chat would
  // 400 for everyone between the two deploys. The new backend ignores an
  // unsigned id and issues a real token instead. Once both are live this
  // field can be dropped.
  sendChatMessage: ({ conversationToken, conversationId, message }) =>
    request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ conversationToken, conversationId, message }),
    }),

  getAvailableDates: (count = 14) => request(`/api/availability/dates?count=${count}`),
  getAvailability: (date) => request(`/api/availability?date=${encodeURIComponent(date)}`),

  bookAppointment: (payload) =>
    request('/api/appointments', { method: 'POST', body: JSON.stringify(payload) }),
  // Changing an appointment requires the booking reference the server
  // issued when it was booked — an appointment id on its own is not proof
  // that the appointment is yours. See the backend's routes/appointments.js.
  rescheduleAppointment: (id, payload) =>
    request(`/api/appointments/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancelAppointment: (id, payload = {}) =>
    request(`/api/appointments/${id}`, { method: 'DELETE', body: JSON.stringify(payload) }),

  // Returning-patient recovery: phone AND booking reference. Replaces the
  // old phone-only search, which returned a patient's appointments to
  // anyone who knew their number.
  lookupAppointment: ({ phone, reference }) =>
    request('/api/appointments/lookup', { method: 'POST', body: JSON.stringify({ phone, reference }) }),

  saveLead: (payload) => request('/api/leads', { method: 'POST', body: JSON.stringify(payload) }),

  requestHandoff: (payload) => request('/api/handoff', { method: 'POST', body: JSON.stringify(payload) }),

  trackEvent: (payload) => request('/api/analytics/event', { method: 'POST', body: JSON.stringify(payload) }),
};

export default api;
