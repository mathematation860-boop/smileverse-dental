/**
 * Thin wrapper around the real Google Calendar v3 client — the ONLY file
 * that actually talks to Google's Calendar API over the network.
 *
 * Uses the scoped `@googleapis/calendar` package, NOT the monolithic
 * `googleapis` package — same generated client code, same API shape
 * (`calendar.freebusy.query`, `calendar.events.insert/patch/delete`), but
 * a few MB instead of 200+ MB of bundled clients for every other Google
 * API this app never calls. (The first deploy of this feature used
 * `googleapis` directly and crashed the production Railway instance —
 * fixed same day by switching to this + `google-auth-library`, see
 * googleOAuthClient.js.)
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

const { calendar_v3 } = require('@googleapis/calendar');
const googleOAuthClient = require('./googleOAuthClient');

/**
 * Every call to Google gets a deadline. Before this there was none, so a
 * hung connection held the patient's booking request open until whatever
 * the platform's own socket timeout happened to be — a spinner with no
 * end, while the request kept a worker busy. The PMS client already did
 * this (services/pms/OpenDentalPMSProvider.js); the calendar client did
 * not, which is the gap this closes.
 *
 * The value is deliberately short. A booking is a foreground request with
 * a person waiting, and a slow answer is worth less than a prompt "try
 * again" — especially now that a timed-out insert is reconciled by event
 * id rather than abandoned (see GoogleCalendarAppointmentProvider).
 */
const CALENDAR_TIMEOUT_MS = Number(process.env.CALENDAR_TIMEOUT_MS) || 10000;

function calendarFor(connection, onTokenRefreshed) {
  const auth = googleOAuthClient.buildAuthorizedClient(connection, onTokenRefreshed);
  return new calendar_v3.Calendar({ auth });
}

function createRealCalendarClient() {
  return {
    /** Real busy intervals for `connection.calendarId` in [timeMinUtc, timeMaxUtc). */
    async getBusyIntervals({ connection, timeMinUtc, timeMaxUtc, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      const res = await calendar.freebusy.query(
        {
          requestBody: {
            timeMin: timeMinUtc.toISOString(),
            timeMax: timeMaxUtc.toISOString(),
            items: [{ id: connection.calendarId }],
          },
        },
        { timeout: CALENDAR_TIMEOUT_MS }
      );
      const busy = res.data?.calendars?.[connection.calendarId]?.busy || [];
      return busy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    },

    /**
     * Creates a real event; returns { id } on success. Throws on any
     * failure — never fabricates an id.
     *
     * `event.id` may be supplied by the caller (Google allows a
     * client-chosen event id). That is what makes a retry after a timeout
     * safe: if the first attempt actually reached Google, the retry comes
     * back 409 rather than creating a second event, and the caller can
     * treat that 409 as "mine, already there". A 409 is surfaced as
     * { alreadyExists: true } instead of an error so the provider does not
     * have to sniff status codes.
     */
    async insertEvent({ connection, event, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      try {
        const res = await calendar.events.insert(
          { calendarId: connection.calendarId, requestBody: event },
          { timeout: CALENDAR_TIMEOUT_MS }
        );
        return res.data;
      } catch (err) {
        const status = err?.code || err?.response?.status;
        if (status === 409 && event && event.id) {
          return { id: event.id, alreadyExists: true };
        }
        throw err;
      }
    },

    /** Updates an existing event's time (used for reschedule). */
    async patchEvent({ connection, eventId, patch, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      const res = await calendar.events.patch(
        { calendarId: connection.calendarId, eventId, requestBody: patch },
        { timeout: CALENDAR_TIMEOUT_MS }
      );
      return res.data;
    },

    /** Deletes an event (used for cancel). A 404/410 (already gone) is treated as success — the outcome the caller wants ("no longer on the calendar") is already true. */
    async deleteEvent({ connection, eventId, onTokenRefreshed }) {
      const calendar = calendarFor(connection, onTokenRefreshed);
      try {
        await calendar.events.delete({ calendarId: connection.calendarId, eventId }, { timeout: CALENDAR_TIMEOUT_MS });
      } catch (err) {
        const status = err?.code || err?.response?.status;
        if (status === 404 || status === 410) return { alreadyRemoved: true };
        throw err;
      }
      return { alreadyRemoved: false };
    },
  };
}

module.exports = { createRealCalendarClient, CALENDAR_TIMEOUT_MS };
