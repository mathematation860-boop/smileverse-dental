/**
 * Thin wrapper around the real `googleapis` Calendar v3 client — the ONLY
 * file that actually talks to Google's Calendar API over the network.
 *
 * GoogleCalendarAppointmentProvider.js depends on an object shaped like
 * this (getBusyIntervals/insertEvent/patchEvent/deleteEvent), not on this
 * file directly — its constructor defaults to `createRealCalendarClient()`
 * but a test can pass in a fake with the same four methods, so the
 * provider's booking/reschedule/cancel/conflict-detection logic can be
 * exercised without a live Google account (see tests/googleCalendarProvider.test.js).
 * This mirrors how services/ai/GeminiAIProvider.js keeps its parsing
 * logic separately testable from the actual SDK call.
 */

const { google } = require('googleapis');
const googleOAuthClient = require('./googleOAuthClient');

function calendarFor(connection, onTokenRefreshed) {
  const auth = googleOAuthClient.buildAuthorizedClient(connection, onTokenRefreshed);
  return google.calendar({ version: 'v3', auth });
}

function createRealCalendarClient() {
  return {
    /** Real busy intervals for `connection.calendarId` in [timeMinUtc, timeMaxUtc). */
    async getBusyIntervals({ connection, timeMinUtc, timeMaxUtc, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: timeMinUtc.toISOString(),
          timeMax: timeMaxUtc.toISOString(),
          items: [{ id: connection.calendarId }],
        },
      });
      const busy = res.data?.calendars?.[connection.calendarId]?.busy || [];
      return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    },

    /** Creates a real event; returns { id } (plus whatever else Google returns) on success. Throws on any failure — never fabricates an id. */
    async insertEvent({ connection, event, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      const res = await calendar.events.insert({ calendarId: connection.calendarId, requestBody: event });
      return res.data;
    },

    /** Updates an existing event's time (used for reschedule). */
    async patchEvent({ connection, eventId, patch, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      const res = await calendar.events.patch({ calendarId: connection.calendarId, eventId, requestBody: patch });
      return res.data;
    },

    /** Deletes an event (used for cancel). A 404/410 (already gone) is treated as success — the outcome the caller wants ("no longer on the calendar") is already true. */
    async deleteEvent({ connection, eventId, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      try {
        await calendar.events.delete({ calendarId: connection.calendarId, eventId });
      } catch (err) {
        const status = err?.code || err?.response?.status;
        if (status === 404 || status === 410) return { alreadyRemoved: true };
        throw err;
      }
      return { alreadyRemoved: false };
    },
  };
}

module.exports = { createRealCalendarClient };
