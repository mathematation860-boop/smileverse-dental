/**
 * What a crash mid-send actually costs.
 *
 * sendNotification claims the idempotency slot BEFORE calling a provider,
 * then records the outcome AFTER (services/notifications/notificationService.js).
 * That ordering is the right one — it is what makes a duplicate send
 * impossible — but it creates two windows where a process death leaves the
 * log and reality disagreeing, and nothing had ever tested either:
 *
 *   Window A — crash AFTER the claim, BEFORE the provider call.
 *   Window B — crash AFTER the provider accepted it, BEFORE the result was
 *              recorded.
 *
 * These are opposite failures and cannot both be fixed by the same choice.
 * Re-sending anything left in the placeholder state would fix A and cause
 * duplicates in B; never re-sending fixes B and silently drops A. The
 * current design picks "never re-send", and these tests establish exactly
 * what that means so the behaviour is a decision on record rather than an
 * accident.
 *
 * NOT LIVE-VERIFIED. The store here is in-memory and the provider is a
 * fake. What is verified is the ORDERING and the consequence of each
 * window — not that MongoDB's unique index behaves as assumed under a real
 * crash, which needs the live check listed in the audit report.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const notificationService = require('../services/notifications/notificationService');

/** Stands in for NotificationLog, enforcing the same unique idempotencyKey. */
function fakeLog() {
  const rows = new Map(); // idempotencyKey -> { _id, status }
  let seq = 0;
  return {
    rows,
    async claim(practiceId, idempotencyKey, meta = {}) {
      if (rows.has(idempotencyKey)) return null; // what E11000 maps to
      const doc = { _id: `log-${++seq}`, practiceId, idempotencyKey, status: 'failed', ...meta };
      rows.set(idempotencyKey, doc);
      return doc;
    },
    async updateResult(id, patch) {
      for (const doc of rows.values()) {
        if (doc._id === id) Object.assign(doc, patch);
      }
      return null;
    },
    statusOf(key) {
      return rows.has(key) ? rows.get(key).status : null;
    },
  };
}

const PRACTICE = {
  practiceId: 'practice-a',
  name: 'Practice A Dental',
  phone: '+1-555-0100',
  email: 'front-desk@example.test',
  timezone: 'America/New_York',
  demoMode: true,
  notifications: { channels: { sms: true, email: false } },
};

// Synthetic patient — invented name, 555 reserved range.
const APPOINTMENT = {
  _id: 'appt-synthetic-1',
  practiceId: 'practice-a',
  name: 'Test Patient One',
  phone: '+1-555-0101',
  service: 'Cleaning',
  date: '2026-10-01',
  time: '10:00 AM',
  smsOptIn: true,
  emailOptIn: false,
};

function deps(log, provider) {
  return {
    notificationLogRepository: log,
    getSmsProvider: () => provider,
    getEmailProvider: () => provider,
  };
}

function recordingProvider(sent) {
  return {
    providerName: 'test-recorder',
    async send() {
      sent.push('sent');
      return { success: true, providerMessageId: 'm1', attempts: 1 };
    },
  };
}

/**
 * Window B modelled faithfully: the provider ACCEPTS the message, and the
 * process then dies before the outcome can be recorded. The death lands on
 * the record write, which is where it would land in production — not on
 * the provider call, since that has already returned.
 */
function logThatDiesBeforeRecording(log) {
  return {
    ...log,
    claim: log.claim.bind(log),
    async updateResult() {
      throw new Error('process died before the result could be recorded');
    },
    statusOf: log.statusOf.bind(log),
    rows: log.rows,
  };
}

test('BASELINE: a clean send happens once and is recorded as sent', async () => {
  const log = fakeLog();
  const sent = [];
  await notificationService.notifyAppointmentReminder(PRACTICE, APPOINTMENT, { offsetHours: 24 }, deps(log, recordingProvider(sent)));

  assert.equal(sent.length, 1);
  assert.equal(log.rows.size, 1);
  const key = [...log.rows.keys()][0];
  assert.equal(log.statusOf(key), 'sent', 'the outcome must be recorded, not left at the claim placeholder');
});

test('WINDOW A: a crash between claiming and sending leaves the slot claimed and nothing sent', async () => {
  const log = fakeLog();
  const sent = [];

  // The process dies the instant after the claim: the provider is never
  // reached. Modelled by a provider lookup that throws before send().
  await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(log, {
      providerName: 'never-reached',
      get send() {
        throw new Error('process died before the provider was called');
      },
    })
  );

  assert.equal(sent.length, 0, 'nothing was sent');
  assert.equal(log.rows.size, 1, 'but the idempotency slot is claimed');
  const key = [...log.rows.keys()][0];
  assert.equal(log.statusOf(key), 'failed', 'and it still holds the claim placeholder');
});

test('WINDOW A, CONSEQUENCE: the retry after restart is SUPPRESSED — the patient never gets that reminder', async () => {
  // This is the cost of the current design, stated plainly rather than
  // discovered by a clinic. It is the deliberate trade for never sending a
  // duplicate (see WINDOW B). Changing it means allowing stale claims to
  // be re-claimed, which reintroduces the duplicate risk — a decision for
  // the pilot, not something to change quietly.
  const log = fakeLog();
  const sent = [];

  await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(log, {
      providerName: 'never-reached',
      get send() {
        throw new Error('process died before the provider was called');
      },
    })
  );

  // Restart: the scheduler recomputes the same due reminder, same key.
  const afterRestart = await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(log, recordingProvider(sent))
  );

  assert.equal(sent.length, 0, 'the reminder is never sent — a real, accepted gap');
  assert.equal(afterRestart.sms.skipped, true);
  assert.equal(afterRestart.sms.reason, 'already_sent', 'the log says "already sent" when in fact it never was');
});

test('WINDOW B: a crash after the provider accepted it leaves the log claimed but not marked sent', async () => {
  const log = fakeLog();
  const sent = [];

  await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(logThatDiesBeforeRecording(log), recordingProvider(sent))
  );

  assert.equal(sent.length, 1, 'the patient DID receive it');
  const key = [...log.rows.keys()][0];
  assert.notEqual(log.statusOf(key), 'sent', 'but the log cannot say so — the record never got written');
});

test('WINDOW B, CONSEQUENCE: the retry after restart does NOT send a second message', async () => {
  // The protective half of the same trade-off: whatever the log says about
  // status, the claim exists, so the patient is not messaged twice.
  const log = fakeLog();
  const sent = [];

  await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(logThatDiesBeforeRecording(log), recordingProvider(sent))
  );
  await notificationService.notifyAppointmentReminder(
    PRACTICE,
    APPOINTMENT,
    { offsetHours: 24 },
    deps(log, recordingProvider(sent))
  );

  assert.equal(sent.length, 1, 'exactly one message reached the patient across the crash and the restart');
});

test('THE TRADE-OFF IS SYMMETRIC: both windows end with a claimed row that is not marked sent', async () => {
  // Which is precisely why the log alone cannot distinguish them, and why
  // "re-send anything still in the placeholder state" would fix Window A
  // at the cost of duplicating Window B. Any future change here needs
  // provider-side delivery status, not a smarter guess about the log.
  const logA = fakeLog();
  const logB = fakeLog();
  const sentB = [];

  await notificationService.notifyAppointmentReminder(PRACTICE, APPOINTMENT, { offsetHours: 24 }, deps(logA, {
    providerName: 'never-reached',
    get send() {
      throw new Error('died before send');
    },
  }));
  await notificationService.notifyAppointmentReminder(PRACTICE, APPOINTMENT, { offsetHours: 24 }, deps(logThatDiesBeforeRecording(logB), recordingProvider(sentB)));

  const statusA = logA.statusOf([...logA.rows.keys()][0]);
  const statusB = logB.statusOf([...logB.rows.keys()][0]);
  assert.equal(statusA, statusB, 'the two windows are indistinguishable from the log');
  assert.equal(sentB.length, 1, 'even though one of them did reach the patient and the other did not');
});

test('RETRY RISK: a provider that THROWS is called again, so a delivered-then-failed send can duplicate', async () => {
  // Documents current behaviour and the risk it carries, rather than
  // changing it — see the correction in services/notifications/retry.js.
  // A thrown error is recorded as `provider_threw`, which is not on the
  // permanent list, so the same message is attempted up to MAX_ATTEMPTS
  // times. If the provider had already accepted it before the connection
  // broke, the patient gets it more than once. Only reachable once a REAL
  // provider is enabled; today's mock providers never throw.
  const log = fakeLog();
  const attempts = [];

  await notificationService.notifyAppointmentReminder(PRACTICE, APPOINTMENT, { offsetHours: 24 }, deps(log, {
    providerName: 'throws-after-accepting',
    async send() {
      attempts.push('attempt');
      throw new Error('connection dropped after the provider accepted the message');
    },
  }));

  assert.ok(attempts.length > 1, 'an ambiguous provider error is currently retried');
  assert.equal(attempts.length, 3, 'up to MAX_ATTEMPTS — so up to three copies if each one actually landed');
});

test('a failure in one notification never takes down the caller', async () => {
  // Everything above relies on this: sendNotification returns a structured
  // result instead of throwing, so a booking is never failed by a
  // notification problem.
  const log = fakeLog();
  const result = await notificationService.notifyAppointmentReminder(PRACTICE, APPOINTMENT, { offsetHours: 24 }, deps(log, {
    providerName: 'broken',
    get send() {
      throw new Error('provider exploded');
    },
  }));
  assert.equal(typeof result, 'object');
  assert.ok(result.sms, 'a structured result, not an exception');
});
