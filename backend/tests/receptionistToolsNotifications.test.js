/**
 * tools/receptionistTools.js's Phase 5 wiring: create_appointment,
 * reschedule_appointment, cancel_appointment, and request_human_handoff
 * must call notificationService ONLY after the underlying action is
 * ALREADY confirmed successful (spec §5/§6/§7/§25 — "never send a
 * confirmation the appointment provider didn't actually confirm").
 *
 * receptionistTools.js's side-effecting functions call
 * services/providers, services/notifications/notificationService,
 * repositories/AnalyticsRepository, and repositories/HandoffRepository
 * directly (not via an injectable `deps` parameter) — this suite uses the
 * same "swap the shared module object's own methods for the duration of
 * one test, then restore them" technique the rest of this repo's DB-free
 * tests rely on implicitly (see that file's own header comment on why its
 * read-only tests avoid the DB-dependent ones). `node --test` runs every
 * test FILE in its own process, so this file's monkey-patching can never
 * leak into any other test file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const tools = require('../tools/receptionistTools');
const appointmentProviders = require('../services/providers');
const notificationService = require('../services/notifications/notificationService');
const analyticsRepository = require('../repositories/AnalyticsRepository');
const handoffRepository = require('../repositories/HandoffRepository');

const PRACTICE = { practiceId: 'test-practice', name: 'Test Dental', phone: '+15550001111', email: 'clinic@example.com' };

function withPatched(target, patches, fn) {
  const originals = {};
  for (const key of Object.keys(patches)) {
    originals[key] = target[key];
    target[key] = patches[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(patches)) target[key] = originals[key];
    });
}

test('create_appointment: notifyAppointmentConfirmation is called ONLY after the provider confirms the booking', async () => {
  let confirmationCalledWith = null;
  const fakeAppointment = { _id: 'a1', name: 'Sarah', phone: '+15551234567', service: 'Cleaning', date: '2026-09-08', time: '2:00 PM' };

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ createAppointment: async () => fakeAppointment }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentConfirmation: async (practice, appointment) => { confirmationCalledWith = { practice, appointment }; return {}; },
    }, () =>
      withPatched(analyticsRepository, { logEvent: async () => {} }, async () => {
        const result = await tools.create_appointment(PRACTICE, { name: 'Sarah', phone: '+15551234567', service: 'Cleaning', date: '2026-09-08', time: '2:00 PM' });
        assert.equal(result, fakeAppointment);
        assert.ok(confirmationCalledWith, 'notifyAppointmentConfirmation must be called after a successful booking');
        assert.equal(confirmationCalledWith.appointment._id, 'a1');
      })
    )
  );
});

test('create_appointment: a booking FAILURE (provider throws) never triggers a confirmation notification', async () => {
  let confirmationCalled = false;

  await assert.rejects(() =>
    withPatched(appointmentProviders, {
      getAppointmentProvider: () => ({ createAppointment: async () => { throw new Error('calendar unavailable'); } }),
    }, () =>
      withPatched(notificationService, {
        notifyAppointmentConfirmation: async () => { confirmationCalled = true; },
      }, () =>
        tools.create_appointment(PRACTICE, { name: 'Sarah', phone: '+15551234567', service: 'Cleaning', date: '2026-09-08', time: '2:00 PM' })
      )
    )
  );

  assert.equal(confirmationCalled, false, 'a failed booking must NEVER send a confirmation');
});

test('reschedule_appointment: notifyAppointmentRescheduled is called after a confirmed reschedule', async () => {
  let calledWith = null;
  const fakeAppointment = { _id: 'a2', date: '2026-09-10', time: '3:00 PM', phone: '+15551234567' };

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ rescheduleAppointment: async () => fakeAppointment }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentRescheduled: async (practice, appointment) => { calledWith = appointment; return {}; },
    }, () =>
      withPatched(analyticsRepository, { logEvent: async () => {} }, async () => {
        const result = await tools.reschedule_appointment(PRACTICE, 'a2', { date: '2026-09-10', time: '3:00 PM' });
        assert.equal(result, fakeAppointment);
        assert.equal(calledWith._id, 'a2');
      })
    )
  );
});

test('reschedule_appointment: a FAILED reschedule (provider returns null — e.g. not found) never triggers a notification', async () => {
  let called = false;

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ rescheduleAppointment: async () => null }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentRescheduled: async () => { called = true; },
    }, async () => {
      const result = await tools.reschedule_appointment(PRACTICE, 'does-not-exist', { date: '2026-09-10', time: '3:00 PM' });
      assert.equal(result, null);
      assert.equal(called, false, 'a failed/not-found reschedule must NEVER send a confirmation');
    })
  );
});

test('cancel_appointment: notifyAppointmentCancelled is called after a confirmed cancellation', async () => {
  let calledWith = null;
  const fakeAppointment = { _id: 'a3', date: '2026-09-08', phone: '+15551234567' };

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ cancelAppointment: async () => fakeAppointment }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentCancelled: async (practice, appointment) => { calledWith = appointment; return {}; },
    }, () =>
      withPatched(analyticsRepository, { logEvent: async () => {} }, async () => {
        const result = await tools.cancel_appointment(PRACTICE, 'a3');
        assert.equal(result, fakeAppointment);
        assert.equal(calledWith._id, 'a3');
      })
    )
  );
});

test('cancel_appointment: a FAILED cancellation (provider returns null) never triggers a notification', async () => {
  let called = false;

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ cancelAppointment: async () => null }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentCancelled: async () => { called = true; },
    }, async () => {
      const result = await tools.cancel_appointment(PRACTICE, 'does-not-exist');
      assert.equal(result, null);
      assert.equal(called, false);
    })
  );
});

test('request_human_handoff: notifies the clinic (spec §15), including for a life-threatening-tagged handoff', async () => {
  let calledWith = null;
  const fakeHandoff = { _id: 'h1', reason: 'requested_staff', phone: '+15551112222', urgency: 'life_threatening' };

  await withPatched(handoffRepository, { create: async () => fakeHandoff }, () =>
    withPatched(notificationService, {
      notifyHumanHandoff: async (practice, handoff) => { calledWith = handoff; return {}; },
    }, () =>
      withPatched(analyticsRepository, { logEvent: async () => {} }, async () => {
        const result = await tools.request_human_handoff(PRACTICE, { conversationId: 'c1', reason: 'requested_staff', phone: '+15551112222', urgency: 'life_threatening' });
        assert.equal(result, fakeHandoff);
        assert.ok(calledWith, 'the clinic must be notified of a handoff');
        assert.equal(calledWith.urgency, 'life_threatening');
      })
    )
  );
});

test('a notification failure never fails an otherwise-successful booking (spec §25)', async () => {
  const fakeAppointment = { _id: 'a4', name: 'Sarah', phone: '+15551234567', service: 'Cleaning', date: '2026-09-08', time: '2:00 PM' };

  await withPatched(appointmentProviders, {
    getAppointmentProvider: () => ({ createAppointment: async () => fakeAppointment }),
  }, () =>
    withPatched(notificationService, {
      notifyAppointmentConfirmation: async () => { throw new Error('SMS provider exploded'); },
    }, () =>
      withPatched(analyticsRepository, { logEvent: async () => {} }, async () => {
        const result = await tools.create_appointment(PRACTICE, { name: 'Sarah', phone: '+15551234567', service: 'Cleaning', date: '2026-09-08', time: '2:00 PM' });
        assert.equal(result, fakeAppointment, 'the booking itself must still succeed even though notifying failed');
      })
    )
  );
});
