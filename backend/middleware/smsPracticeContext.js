/**
 * Resolves WHICH practice an inbound SMS webhook belongs to, and verifies
 * it genuinely came from the SMS provider — the SMS-channel equivalent of
 * middleware/voicePracticeContext.js (Phase 4), built the exact same way
 * for the exact same reason: an inbound text has no client-controllable
 * "which practice is this" signal, so the only safe source of truth is
 * which of THIS deployment's own numbers was texted, reported in the
 * provider's own signed webhook body's "To" field (Phase 5 spec §11: this
 * reuses config/practiceRepository.js's getPracticeIdForPhoneNumber(),
 * which already checks BOTH voice.phoneNumber and
 * notifications.smsPhoneNumber).
 *
 * Also does double duty as the webhook signature check (spec §20/§21): a
 * genuine per-practice SMSProvider can only be selected once the practice
 * is known, and a forged request must never reach any business logic —
 * both live in one middleware routes/smsWebhook.js's endpoints run first.
 */

const practiceRepositoryReal = require('../config/practiceRepository');
const notificationProvidersReal = require('../services/notifications');
const { getPublicRequestUrl } = require('./voicePracticeContext');

function buildSmsPracticeContext(deps = {}) {
  const practiceRepository = deps.practiceRepository || practiceRepositoryReal;
  const notificationProviders = deps.notificationProviders || notificationProvidersReal;

  return async function smsPracticeContext(req, res, next) {
    const toNumber = req.body?.To;
    const practiceId = practiceRepository.getPracticeIdForPhoneNumber(toNumber);

    if (!practiceId) {
      console.warn(`smsPracticeContext: no practice configured for texted number "${toNumber}" — rejecting message`);
      // No JSON error channel for an inbound-SMS webhook either — reply
      // with valid (empty) Messaging TwiML rather than an error status, so
      // Twilio doesn't retry a request that will never resolve differently.
      res.type('text/xml');
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    const practice = await practiceRepository.getPracticeResolved(practiceId);
    const provider = notificationProviders.getSmsProvider(practice);

    const signatureHeader = req.headers['x-twilio-signature'];
    const fullUrl = getPublicRequestUrl(req);
    const verification = provider.verifyWebhookSignature({ signatureHeader, fullUrl, params: req.body });

    // Structured observability (spec §23) — identifiers and verification
    // outcome only; NEVER the auth token/signature value itself.
    console.log(JSON.stringify({
      event: 'sms_webhook_received',
      practiceId,
      messageSid: req.body?.MessageSid || req.body?.SmsSid,
      provider: provider.providerName,
      signatureValid: verification.valid,
      signatureReason: verification.reason,
    }));

    if (!verification.valid) {
      console.warn(`smsPracticeContext: rejected unverified webhook for practice "${practiceId}" (${verification.reason})`);
      return res.status(403).json({ error: 'Webhook signature verification failed' });
    }

    req.practiceId = practice.practiceId;
    req.practice = practice;
    req.smsProvider = provider;
    next();
  };
}

module.exports = buildSmsPracticeContext();
module.exports.buildSmsPracticeContext = buildSmsPracticeContext;
