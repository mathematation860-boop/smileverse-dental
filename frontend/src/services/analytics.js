/**
 * Frontend event-tracking abstraction.
 *
 * Every screen/component calls trackEvent(name, payload) instead of
 * knowing anything about how or where events are stored. Right now that
 * just POSTs to our own backend (which logs to MongoDB — see
 * backend/services/analyticsService.js), but swapping in a real product
 * analytics tool later (Segment, Amplitude, PostHog, ...) only means
 * changing the inside of this one function.
 *
 * Never throws — a tracking failure must never interrupt the patient's
 * conversation or booking flow.
 */

import api from './api';

export const EVENTS = {
  CONVERSATION_STARTED: 'conversation_started',
  APPOINTMENT_REQUESTED: 'appointment_requested',
  APPOINTMENT_BOOKED: 'appointment_booked',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  APPOINTMENT_RESCHEDULED: 'appointment_rescheduled',
  EMERGENCY_REQUEST: 'emergency_request',
  HUMAN_HANDOFF_REQUESTED: 'human_handoff_requested',
  UNANSWERED_QUESTION: 'unanswered_question',
};

export function trackEvent(name, conversationId, payload = {}) {
  api.trackEvent({ name, conversationId, payload }).catch(() => {
    // Analytics is best-effort only.
  });
}
