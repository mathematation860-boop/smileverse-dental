/**
 * The notification orchestrator (Phase 5 spec §1's diagram: Appointment/
 * Event -> Notification service -> SMS/Email provider -> Patient). This is
 * the ONE place notification business logic lives — every call site
 * (tools/receptionistTools.js for booking/cancel/reschedule/handoff,
 * services/receptionistEngine.js + services/voice/voiceReceptionistEngine.js
 * for the emergency clinic alert, services/notifications/reminderScheduler.js
 * for reminders) calls a function here rather than touching a provider or
 * a template directly, so there is exactly one implementation of "what
 * sending an appointment notification means" (spec §1: "do not duplicate
 * notification business logic across routes").
 *
 * Every public function here is fire-and-forget SAFE: it never throws, and
 * a notification failure NEVER changes anything about the
 * appointment/handoff/conversation it's attached to (spec §25). Call sites
 * are still free to `await` these (so, e.g., a test can inspect the
 * result) — "safe to not await" and "safe to await" are the same
 * guarantee here.
 */

const notificationLogRepository = require('../../repositories/NotificationLogRepository');
const { getEmailProvider, getSmsProvider } = require('./index');
const templates = require('./templates');
const validation = require('./validation');
const { sendWithRetry } = require('./retry');

/**
 * Sends ONE notification (one channel, one type) and records it to
 * history. Never throws — every failure mode (invalid destination,
 * disabled channel, already-sent, provider failure) is returned as a
 * structured result, not an exception, so a caller composing several of
 * these (e.g. SMS + email confirmation) never needs its own try/catch
 * around each one.
 */
async function sendNotification({ practice, type, channel, to, variables, language = 'en', idempotencyKey, meta = {} }, deps = {}) {
  const logRepository = deps.notificationLogRepository || notificationLogRepository;
  const getEmail = deps.getEmailProvider || getEmailProvider;
  const getSms = deps.getSmsProvider || getSmsProvider;

  try {
    // 1. Destination validation FIRST (spec §10) — never even claim a slot
    // for a destination that could never have worked.
    const isEmail = channel === 'email';
    const validDestination = isEmail ? validation.isValidEmail(to) : validation.isValidPhone(to);
    const destinationMasked = isEmail ? validation.maskEmail(to) : validation.maskPhone(to);

    if (!to || !validDestination) {
      console.log(JSON.stringify({ event: 'notification_skipped', practiceId: practice.practiceId, type, channel, reason: isEmail ? 'invalid_email' : 'invalid_phone' }));
      return { attempted: false, success: false, skipped: true, reason: isEmail ? 'invalid_email' : 'invalid_phone' };
    }

    // 2. Claim the idempotency slot BEFORE ever calling a provider (spec
    // §9/§24) — this is what makes a retried webhook, a second reminder
    // poll tick, or a second running instance never send the same
    // notification twice, even across a server restart.
    const claimed = await logRepository.claim(practice.practiceId, idempotencyKey, {
      type, channel, language, destinationMasked,
      appointmentId: meta.appointmentId, conversationId: meta.conversationId, callSid: meta.callSid,
      demoMode: practice.demoMode !== false,
    });
    if (!claimed) {
      console.log(JSON.stringify({ event: 'notification_deduped', practiceId: practice.practiceId, type, channel, idempotencyKey }));
      return { attempted: false, success: false, skipped: true, reason: 'already_sent' };
    }

    // 3. Render the template (practice-aware, sanitized — see templates.js).
    const rendered = templates.render(type, channel, variables, language);

    // 4. Select the provider (demoMode-gated — see ./index.js) and send,
    // with bounded retry for temporary failures only (spec §24).
    const provider = isEmail ? getEmail(practice) : getSms(practice);
    const result = await sendWithRetry(() =>
      isEmail
        ? provider.send({ to, subject: rendered.subject, text: rendered.text, html: rendered.html })
        : provider.send({ to, body: rendered.body })
    );

    const status = result.simulated ? 'simulated' : result.success ? 'sent' : 'failed';
    await logRepository.updateResult(claimed._id, {
      status,
      provider: provider.providerName,
      providerMessageId: result.providerMessageId,
      providerStatus: result.providerStatus,
      failureReason: result.failureReason,
      attempts: result.attempts,
    });

    // 5. Structured observability (spec §23) — identifiers and outcome
    // only; never the message body, never a provider secret/token.
    console.log(JSON.stringify({
      event: 'notification_attempted',
      notificationId: String(claimed._id),
      practiceId: practice.practiceId,
      appointmentId: meta.appointmentId || null,
      channel, type, provider: provider.providerName, status,
      failureReason: result.failureReason || null,
      attempts: result.attempts,
    }));

    return { attempted: true, success: status !== 'failed', simulated: status === 'simulated', status, failureReason: result.failureReason };
  } catch (err) {
    // Last-resort net — a notification must NEVER throw into its caller
    // (spec §16/§25). Anything unexpected (a DB hiccup on claim/update,
    // a template error) degrades to a logged, honest failure.
    console.error('notificationService.sendNotification: unexpected error (non-fatal):', err.message);
    return { attempted: false, success: false, skipped: false, reason: 'internal_error' };
  }
}

function commonVariables(practice) {
  return { practiceName: practice.name, practicePhone: practice.phone, practiceEmail: practice.email };
}

function appointmentVariables(practice, appointment) {
  return {
    ...commonVariables(practice),
    patientName: appointment.name || 'there',
    serviceName: appointment.service || 'your appointment',
    appointmentDate: appointment.date,
    appointmentTime: appointment.time,
  };
}

/** Practice-level channel toggle — an admin can disable a whole channel for their practice (spec §19); never invented, always read off practice.notifications (base config, admin-overridable — see practiceMerge.js). */
function channelEnabled(practice, channel) {
  const notif = practice.notifications || {};
  return channel === 'sms' ? notif.smsEnabled !== false : notif.emailEnabled !== false;
}

/** Per-patient opt-out (spec §19) — read off the appointment record itself, the only place this demo app has patient-level contact preferences. Defaults to opted-in for TRANSACTIONAL appointment notifications (never marketing — this phase implements no marketing sends at all). */
function patientOptedIn(appointment, channel) {
  return channel === 'sms' ? appointment.smsOptIn !== false : appointment.emailOptIn !== false;
}

/**
 * Fires SMS + email for one appointment-lifecycle event (confirmation/
 * reschedule/cancellation). Only ever called by tools/receptionistTools.js
 * AFTER the appointment provider has already confirmed the underlying
 * action succeeded (spec §5/§6/§7/§25) — this function has no way to
 * "un-book" anything, so it must never be called speculatively.
 */
async function notifyAppointmentEvent(type, practice, appointment, { language = 'en', extraIdemSuffix = '' } = {}, deps = {}) {
  const results = { sms: null, email: null };
  const appointmentId = String(appointment._id || appointment.id || '');
  const variables = appointmentVariables(practice, appointment);
  const meta = { appointmentId, conversationId: appointment.conversationId };

  if (channelEnabled(practice, 'sms') && patientOptedIn(appointment, 'sms')) {
    results.sms = await sendNotification({
      practice, type, channel: 'sms', to: appointment.phone, variables, language,
      idempotencyKey: `${practice.practiceId}:appt:${appointmentId}:${type}:sms${extraIdemSuffix}`,
      meta,
    }, deps);
  }
  if (channelEnabled(practice, 'email') && patientOptedIn(appointment, 'email') && appointment.email) {
    results.email = await sendNotification({
      practice, type, channel: 'email', to: appointment.email, variables, language,
      idempotencyKey: `${practice.practiceId}:appt:${appointmentId}:${type}:email${extraIdemSuffix}`,
      meta,
    }, deps);
  }
  return results;
}

async function notifyAppointmentConfirmation(practice, appointment, opts = {}, deps = {}) {
  return notifyAppointmentEvent('appointment_confirmation', practice, appointment, opts, deps);
}

async function notifyAppointmentRescheduled(practice, appointment, opts = {}, deps = {}) {
  return notifyAppointmentEvent('appointment_rescheduled', practice, appointment, opts, deps);
}

async function notifyAppointmentCancelled(practice, appointment, opts = {}, deps = {}) {
  return notifyAppointmentEvent('appointment_cancelled', practice, appointment, opts, deps);
}

/** Called only by reminderScheduler.js, once per (appointment, configured offset) — the idempotencyKey below is what actually prevents the same reminder firing twice (spec §8/§9). */
async function notifyAppointmentReminder(practice, appointment, { offsetHours, language = 'en' }, deps = {}) {
  return notifyAppointmentEvent('appointment_reminder', practice, appointment, { language, extraIdemSuffix: `:${offsetHours}h` }, deps);
}

/** Clinic-facing (not patient-facing) — notifies the PRACTICE's own configured contact, never the patient, and includes only what staff need to act (spec §15). */
async function notifyHumanHandoff(practice, handoff, deps = {}) {
  const notif = practice.notifications || {};
  const clinicPhone = notif.clinicAlertPhone || practice.phone;
  const clinicEmail = notif.clinicAlertEmail || practice.email;
  const urgent = handoff.urgency === 'urgent' || handoff.urgency === 'life_threatening';

  const variables = {
    ...commonVariables(practice),
    handoffReason: `${urgent ? 'URGENT — ' : ''}${handoff.reason || 'general inquiry'}`,
    patientName: handoff.name || 'Not provided',
    practicePhone2: handoff.phone || 'Not provided',
  };
  const handoffId = String(handoff._id || handoff.id || Date.now());
  const meta = { conversationId: handoff.conversationId };

  const results = { sms: null, email: null };
  if (channelEnabled(practice, 'sms') && clinicPhone) {
    results.sms = await sendNotification({
      practice, type: 'human_handoff', channel: 'sms', to: clinicPhone, variables,
      idempotencyKey: `${practice.practiceId}:handoff:${handoffId}:human_handoff:sms`,
      meta,
    }, deps);
  }
  if (channelEnabled(practice, 'email') && clinicEmail) {
    results.email = await sendNotification({
      practice, type: 'human_handoff', channel: 'email', to: clinicEmail, variables,
      idempotencyKey: `${practice.practiceId}:handoff:${handoffId}:human_handoff:email`,
      meta,
    }, deps);
  }
  return results;
}

/**
 * Emergency clinic alert (spec §16) — MUST NEVER block or delay the
 * patient's own emergency response. Call sites (services/receptionistEngine.js,
 * services/voice/voiceReceptionistEngine.js) call this WITHOUT awaiting it
 * (fire-and-forget with its own .catch), and this function additionally
 * wraps its own body in try/catch so it can never produce an unhandled
 * rejection even if a caller forgets to. A failure here is silently
 * logged, never surfaced to the patient-facing response in any way.
 */
async function notifyEmergencyClinicAlert(practice, { conversationId, channel: sourceChannel, callSid } = {}, deps = {}) {
  try {
    const notif = practice.notifications || {};
    const clinicPhone = notif.clinicAlertPhone || practice.phone;
    const clinicEmail = notif.clinicAlertEmail || practice.email;
    const variables = { ...commonVariables(practice), handoffReason: sourceChannel || 'conversation' };
    // One alert per conversation — a caller repeating emergency language
    // multiple times in one call/chat must not page the clinic over and
    // over for the same event.
    const idBase = `${practice.practiceId}:emergency:${conversationId || callSid || 'unknown'}`;
    const meta = { conversationId, callSid };

    if (channelEnabled(practice, 'sms') && clinicPhone) {
      await sendNotification({ practice, type: 'emergency_alert', channel: 'sms', to: clinicPhone, variables, idempotencyKey: `${idBase}:sms`, meta }, deps);
    }
    if (channelEnabled(practice, 'email') && clinicEmail) {
      await sendNotification({ practice, type: 'emergency_alert', channel: 'email', to: clinicEmail, variables, idempotencyKey: `${idBase}:email`, meta }, deps);
    }
  } catch (err) {
    console.error('notifyEmergencyClinicAlert: failed (non-fatal, never blocks patient emergency response):', err.message);
  }
}

module.exports = {
  sendNotification,
  notifyAppointmentConfirmation,
  notifyAppointmentRescheduled,
  notifyAppointmentCancelled,
  notifyAppointmentReminder,
  notifyHumanHandoff,
  notifyEmergencyClinicAlert,
};
