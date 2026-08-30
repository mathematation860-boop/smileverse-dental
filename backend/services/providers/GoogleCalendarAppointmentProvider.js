/**
 * Real Google Calendar-backed AppointmentProvider — Phase 2.
 *
 * Implements the exact same interface as DemoAppointmentProvider.js (see
 * AppointmentProvider.js), so no route, no frontend component, and no AI
 * prompt has to know which one is actually running for a given practice
 * (see ./index.js for the demoMode/calendarProvider switch).
 *
 * Every method that changes something (create/reschedule/cancel) asks the
 * real Google Calendar API to confirm the change FIRST, and only then
 * touches the local Appointment record — never the other way around. In
 * particular, createAppointment never creates a local "Confirmed" record
 * unless Google Calendar actually returned a real event id, which is what
 * makes "the AI must never claim a booking succeeded unless Google
 * Calendar confirms it" true at the data layer, not just in the prompt
 * text (see config/promptBuilder.js and tests/googleCalendarProvider.test.js
 * "AI cannot claim false booking").
 *
 * Dependencies (calendarClient / connectionRepo / appointmentRepo) are
 * constructor-injectable so tests can exercise all of this real
 * orchestration logic (conflict detection, duration handling, the
 * "never persist without real confirmation" rule) with in-memory fakes —
 * this sandbox has no live Google account or reachable MongoDB to test
 * against directly. Production code (./index.js) constructs this with no
 * arguments, which uses the real `googleapis` client and real Mongoose
 * repositories.
 */

const AppointmentProvider = require('./AppointmentProvider');
const availabilityService = require('../availabilityService');
const googleCalendarLogic = require('./googleCalendarLogic');
const { CalendarUnavailableError, SlotUnavailableError } = require('./CalendarProviderErrors');
const { zonedWallTimeToUtc } = require('../../utils/timezone');
const { createRealCalendarClient } = require('../calendar/googleCalendarClient');
const defaultConnectionRepo = require('../../repositories/CalendarConnectionRepository');
const defaultAppointmentRepo = require('../../repositories/AppointmentRepository');

function buildEventDescription(data) {
  const lines = [
    `Booked via ${data.practiceName || 'AI receptionist'}.`,
    data.name ? `Patient: ${data.name}` : null,
    data.phone ? `Phone: ${data.phone}` : null,
    data.email ? `Email: ${data.email}` : null,
    data.patientType ? `Patient type: ${data.patientType}` : null,
    data.reason ? `Reason: ${data.reason}` : null,
    data.isEmergency ? 'Flagged as an emergency/urgent request.' : null,
  ].filter(Boolean);
  return lines.join('\n');
}

class GoogleCalendarAppointmentProvider extends AppointmentProvider {
  constructor(deps = {}) {
    super();
    this.calendarClient = deps.calendarClient || createRealCalendarClient();
    this.connectionRepo = deps.connectionRepo || defaultConnectionRepo;
    this.appointmentRepo = deps.appointmentRepo || defaultAppointmentRepo;
  }

  async _getConnection(practice) {
    const connection = await this.connectionRepo.findByPracticeId(practice.practiceId);
    if (!connection) throw new CalendarUnavailableError('not_connected');
    return connection;
  }

  async _persistRefreshedToken(practice, tokens) {
    try {
      await this.connectionRepo.updateAccessToken(practice.practiceId, tokens);
    } catch (err) {
      // Non-fatal: worst case, the next call refreshes the access token
      // again instead of reusing a cached one. Never let this break the
      // request that's actually in flight.
      console.error('GoogleCalendarAppointmentProvider: failed to persist refreshed token:', err.message);
    }
  }

  async _getBusyIntervals(practice, connection, timeMinUtc, timeMaxUtc) {
    try {
      return await this.calendarClient.getBusyIntervals({
        connection,
        timeMinUtc,
        timeMaxUtc,
        onTokenRefreshed: (tokens) => this._persistRefreshedToken(practice, tokens),
      });
    } catch (err) {
      throw new CalendarUnavailableError('api_error', err);
    }
  }

  async getAvailability(practice, dateStr, { durationMinutes } = {}) {
    if (!availabilityService.isOpenDay(practice, dateStr)) {
      return { date: dateStr, isOpen: false, slots: [] };
    }

    const connection = await this._getConnection(practice); // throws CalendarUnavailableError if this practice never connected a calendar
    const dayStartUtc = zonedWallTimeToUtc(dateStr, practice.hours.openTime, practice.timezone);
    const dayEndUtc = zonedWallTimeToUtc(dateStr, practice.hours.closeTime, practice.timezone);
    const busy = await this._getBusyIntervals(practice, connection, dayStartUtc, dayEndUtc);

    return {
      date: dateStr,
      isOpen: true,
      slots: googleCalendarLogic.computeAvailableSlots(practice, dateStr, busy, { durationMinutes }),
    };
  }

  getAvailableDates(practice, count) {
    // Which days the practice is open is a business-hours fact, not a
    // calendar fact — no need to touch Google for this (mirrors Demo).
    return availabilityService.nextOpenDates(practice, count);
  }

  async createAppointment(practice, data) {
    const duration = googleCalendarLogic.getServiceDuration(practice, data.serviceId, practice.hours.slotMinutes);

    if (!googleCalendarLogic.isWithinBusinessHours(practice, data.date, data.time, duration)) {
      throw new SlotUnavailableError('outside_hours');
    }

    const window = googleCalendarLogic.computeSlotWindowUtc(practice, data.date, data.time, duration);
    if (!window) throw new SlotUnavailableError('invalid_time');

    const connection = await this._getConnection(practice);
    const busy = await this._getBusyIntervals(practice, connection, window.startUtc, window.endUtc);
    if (!googleCalendarLogic.isSlotFree(window.startUtc, window.endUtc, busy)) {
      throw new SlotUnavailableError('busy');
    }

    const event = {
      summary: `${data.service || 'Appointment'} — ${data.name || 'Patient'}`,
      description: buildEventDescription({ ...data, practiceName: practice.name }),
      start: { dateTime: window.startUtc.toISOString(), timeZone: 'UTC' },
      end: { dateTime: window.endUtc.toISOString(), timeZone: 'UTC' },
    };

    let created;
    try {
      created = await this.calendarClient.insertEvent({
        connection,
        event,
        onTokenRefreshed: (tokens) => this._persistRefreshedToken(practice, tokens),
      });
    } catch (err) {
      throw new CalendarUnavailableError('api_error', err);
    }
    if (!created || !created.id) {
      // Defensive: never persist a "Confirmed" appointment without a real
      // event id to prove Google actually created it.
      throw new CalendarUnavailableError('api_error');
    }

    // Only now — after Google Calendar actually confirmed the event —
    // does a local appointment record get created at all.
    return this.appointmentRepo.create(practice.practiceId, {
      ...data,
      calendarEventId: created.id,
      calendarProvider: 'google',
    });
  }

  async rescheduleAppointment(practice, id, { date, time }) {
    const appointment = await this.appointmentRepo.findById(practice.practiceId, id);
    if (!appointment) return null;
    if (!appointment.calendarEventId) {
      // This appointment was never actually calendar-backed (e.g. booked
      // while the practice was still in demo mode) — there is nothing
      // real to reschedule on the calendar, so refuse rather than
      // silently only updating the local record.
      throw new CalendarUnavailableError('no_calendar_event');
    }

    const newDate = date || appointment.date;
    const newTime = time || appointment.time;
    const duration = googleCalendarLogic.getServiceDuration(practice, appointment.serviceId, practice.hours.slotMinutes);

    if (!googleCalendarLogic.isWithinBusinessHours(practice, newDate, newTime, duration)) {
      throw new SlotUnavailableError('outside_hours');
    }

    const newWindow = googleCalendarLogic.computeSlotWindowUtc(practice, newDate, newTime, duration);
    if (!newWindow) throw new SlotUnavailableError('invalid_time');

    const connection = await this._getConnection(practice);
    const busy = await this._getBusyIntervals(practice, connection, newWindow.startUtc, newWindow.endUtc);

    // Exclude this appointment's OWN current slot from the conflict check
    // — otherwise moving a booking a few minutes within its own block
    // always looks "busy" because of itself.
    const ownWindow = googleCalendarLogic.computeSlotWindowUtc(practice, appointment.date, appointment.time, duration);
    const ignoreIntervals = ownWindow ? [{ start: ownWindow.startUtc, end: ownWindow.endUtc }] : [];

    if (!googleCalendarLogic.isSlotFree(newWindow.startUtc, newWindow.endUtc, busy, ignoreIntervals)) {
      throw new SlotUnavailableError('busy');
    }

    try {
      await this.calendarClient.patchEvent({
        connection,
        eventId: appointment.calendarEventId,
        patch: {
          start: { dateTime: newWindow.startUtc.toISOString(), timeZone: 'UTC' },
          end: { dateTime: newWindow.endUtc.toISOString(), timeZone: 'UTC' },
        },
        onTokenRefreshed: (tokens) => this._persistRefreshedToken(practice, tokens),
      });
    } catch (err) {
      throw new CalendarUnavailableError('api_error', err);
    }

    return this.appointmentRepo.update(practice.practiceId, id, { date: newDate, time: newTime, status: 'Rescheduled' });
  }

  async cancelAppointment(practice, id) {
    const appointment = await this.appointmentRepo.findById(practice.practiceId, id);
    if (!appointment) return null;

    if (appointment.calendarEventId) {
      const connection = await this._getConnection(practice);
      try {
        await this.calendarClient.deleteEvent({
          connection,
          eventId: appointment.calendarEventId,
          onTokenRefreshed: (tokens) => this._persistRefreshedToken(practice, tokens),
        });
      } catch (err) {
        throw new CalendarUnavailableError('api_error', err);
      }
    }

    return this.appointmentRepo.update(practice.practiceId, id, { status: 'Cancelled' });
  }

  async getAppointment(practice, id) {
    return this.appointmentRepo.findById(practice.practiceId, id);
  }

  async searchAppointments(practice, phone) {
    return this.appointmentRepo.findByPhone(practice.practiceId, phone);
  }

  async getAllAppointments(practice) {
    return this.appointmentRepo.findAll(practice.practiceId);
  }
}

module.exports = GoogleCalendarAppointmentProvider;
