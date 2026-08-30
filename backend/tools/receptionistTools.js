/**
 * The receptionist "tools" layer.
 *
 * Every piece of real business logic the receptionist can act on lives
 * HERE, as a named function matching the AI-tool vocabulary from the
 * product spec (get_practice_info, create_appointment, etc.). REST
 * routes are thin wrappers that call these; nothing fabricates a result
 * — every tool either returns real data (from a repository/provider) or
 * a clearly-labeled "I don't have enough information" response.
 *
 * Honest note on how the AI uses these today: the chat AI (see
 * services/ai/GeminiAIProvider.js) selects an `intent` that corresponds
 * to one of these tools and extracts the arguments it would need, but it
 * does not yet invoke these functions itself via native LLM
 * function-calling — that's the natural next step. Today, the actual
 * side-effecting tools (create/reschedule/cancel_appointment,
 * request_human_handoff, create_callback_request) are invoked by the
 * deterministic UI (BookingFlow/HandoffPanel) calling the matching REST
 * route, which calls the SAME function defined here. Read-only tools
 * (get_practice_info, get_services, etc.) are also what the REST routes
 * return, and are additionally baked into the AI's system prompt (see
 * config/promptBuilder.js) so the AI answers from this exact data rather
 * than inventing it. Either path — AI prompt or REST route — ends up
 * calling this same function, so there is exactly one source of truth.
 */

const appointmentProviders = require('../services/providers');
const insuranceService = require('../services/insuranceService');
const handoffRepository = require('../repositories/HandoffRepository');
const analyticsRepository = require('../repositories/AnalyticsRepository');
const { getEmailProvider, getSmsProvider, notifySafely } = require('../services/notifications');

function get_practice_info(practice) {
  const { practiceId, name, tagline, phone, email, address, website, timezone, hours, demoMode } = practice;
  return { practiceId, name, tagline, phone, email, address, website, timezone, hours, demoMode };
}

function get_services(practice) {
  return practice.services;
}

function get_service_details(practice, serviceId) {
  return practice.services.find((s) => s.id === serviceId) || null;
}

function get_hours(practice) {
  return practice.hours;
}

function get_location(practice) {
  return { address: practice.address, timezone: practice.timezone };
}

function get_insurance_information(practice, provider) {
  if (!provider) return insuranceService.listAccepted(practice);
  return insuranceService.checkProvider(practice, provider);
}

/**
 * Real availability check (Phase 2) — the "check real availability" tool.
 * Backed by whichever provider this practice is actually running on
 * (mock in demo mode, real Google Calendar in production — see
 * services/providers/index.js), so this function's result is exactly as
 * real as the underlying provider: in production mode it reflects the
 * practice's actual Google Calendar, including real busy events, real
 * business hours, and real service duration. Throws CalendarUnavailableError
 * if a real check could not be performed — callers must not fabricate a
 * result in that case (see routes/availability.js and routes/appointments.js).
 */
async function check_availability(practice, date, { durationMinutes } = {}) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  return provider.getAvailability(practice, date, { durationMinutes });
}

async function search_appointments(practice, phone) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  return provider.searchAppointments(practice, phone);
}

async function get_patient_appointment(practice, appointmentId) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  return provider.getAppointment(practice, appointmentId);
}

async function create_appointment(practice, data) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  const appointment = await provider.createAppointment(practice, data);

  notifySafely(() =>
    getEmailProvider(practice).send({
      to: data.email || null,
      subject: `Appointment confirmed — ${practice.name}`,
      body: `Your ${data.service} appointment is confirmed for ${data.date} at ${data.time}.`,
    })
  );
  notifySafely(() =>
    getSmsProvider(practice).send({
      to: data.phone,
      body: `${practice.name}: your ${data.service} appointment is confirmed for ${data.date} at ${data.time}.`,
    })
  );
  await analyticsRepository.logEvent(practice.practiceId, 'appointment_booked', data.conversationId, {
    serviceId: data.serviceId,
    date: data.date,
    time: data.time,
    isEmergency: !!data.isEmergency,
  });

  return appointment;
}

async function reschedule_appointment(practice, appointmentId, { date, time, conversationId }) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  const appointment = await provider.rescheduleAppointment(practice, appointmentId, { date, time });
  if (!appointment) return null;

  notifySafely(() =>
    getSmsProvider(practice).send({
      to: appointment.phone,
      body: `${practice.name}: your appointment has been rescheduled to ${appointment.date} at ${appointment.time}.`,
    })
  );
  await analyticsRepository.logEvent(practice.practiceId, 'appointment_rescheduled', conversationId, {
    id: appointment._id,
    date,
    time,
  });

  return appointment;
}

async function cancel_appointment(practice, appointmentId, { conversationId } = {}) {
  const provider = appointmentProviders.getAppointmentProvider(practice);
  const appointment = await provider.cancelAppointment(practice, appointmentId);
  if (!appointment) return null;

  notifySafely(() =>
    getSmsProvider(practice).send({
      to: appointment.phone,
      body: `${practice.name}: your appointment on ${appointment.date} has been cancelled.`,
    })
  );
  await analyticsRepository.logEvent(practice.practiceId, 'appointment_cancelled', conversationId, { id: appointment._id });

  return appointment;
}

async function request_human_handoff(practice, { conversationId, reason, type, name, phone, message, urgency }) {
  const handoff = await handoffRepository.create(practice.practiceId, {
    conversationId,
    reason: reason || 'uncertain',
    type: type || 'request_callback',
    name,
    phone,
    message,
    // Real, not invented: whatever emergencyService.classifyUrgency (or the
    // AI's own urgency read) already determined for this conversation, if
    // any — see routes/handoff.js for where this is looked up. Never
    // guessed here.
    urgency: urgency === 'life_threatening' || urgency === 'urgent' ? urgency : 'normal',
  });

  await analyticsRepository.logEvent(practice.practiceId, 'human_handoff_requested', conversationId, { reason, type });

  return handoff;
}

async function create_callback_request(practice, { conversationId, name, phone, message }) {
  return request_human_handoff(practice, {
    conversationId,
    reason: 'callback_requested',
    type: 'request_callback',
    name,
    phone,
    message,
  });
}

module.exports = {
  get_practice_info,
  get_services,
  get_service_details,
  get_hours,
  get_location,
  get_insurance_information,
  check_availability,
  search_appointments,
  get_patient_appointment,
  create_appointment,
  reschedule_appointment,
  cancel_appointment,
  request_human_handoff,
  create_callback_request,
};
