/**
 * Resolves WHICH practice an incoming telephony webhook belongs to, and
 * verifies the webhook is genuinely from the telephony provider — the
 * voice-channel equivalent of middleware/practiceContext.js, but built
 * for a completely different trust model.
 *
 * middleware/practiceContext.js trusts an `X-Practice-Id` header because
 * the current frontend controls that header itself. A phone call has no
 * equivalent the caller could set — the ONLY safe signal for which
 * practice a call belongs to is which of THIS deployment's own phone
 * numbers was actually dialed, which the telephony provider reports in
 * the "To" field of its own signed webhook body (Phase 4 spec §5: never
 * trust a caller-supplied practiceId). That is why this file exists
 * separately rather than just reusing practiceContext.js.
 *
 * This also does double duty as the webhook signature check (spec §21/
 * §22): a genuine per-practice TelephonyProvider can only be selected
 * once the practice is known, and a forged request must never reach any
 * business logic, so both checks live in one middleware that every
 * routes/voice.js endpoint runs first.
 */

const practiceRepositoryReal = require('../config/practiceRepository');
const voiceProvidersReal = require('../services/voice');

/** The exact URL the telephony provider actually POSTed to — required for Twilio's signature check to match. Reads X-Forwarded-* first since Railway/most PaaS terminate TLS in front of this app (req.protocol/req.get('host') alone would report the internal http/proxy host, not the public https URL Twilio signed against). */
function getPublicRequestUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = (req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}${req.originalUrl}`;
}

function buildVoicePracticeContext(deps = {}) {
  const practiceRepository = deps.practiceRepository || practiceRepositoryReal;
  const voiceProviders = deps.voiceProviders || voiceProvidersReal;

  return async function voicePracticeContext(req, res, next) {
    const toNumber = req.body?.To;
    const practiceId = practiceRepository.getPracticeIdForPhoneNumber(toNumber);

    if (!practiceId) {
      console.warn(`voicePracticeContext: no practice configured for dialed number "${toNumber}" — rejecting call`);
      // A phone call has no JSON error channel — respond with valid TwiML
      // so the caller hears a clean message instead of a dead line or an
      // error tone, without ever guessing which practice this might be.
      res.type('text/xml');
      return res.status(200).send(
        '<?xml version="1.0" encoding="UTF-8"?><Response>' +
        '<Say>We\'re sorry, this number is not currently in service. Please check the number and try again.</Say>' +
        '<Hangup/></Response>'
      );
    }

    const practice = await practiceRepository.getPracticeResolved(practiceId);
    const provider = voiceProviders.getTelephonyProvider(practice);

    const signatureHeader = req.headers['x-twilio-signature'];
    const fullUrl = getPublicRequestUrl(req);
    const verification = provider.verifyWebhookSignature({ signatureHeader, fullUrl, params: req.body });

    // Structured observability log (Phase 4 spec §23) — session/practice/
    // provider identifiers and the verification outcome only; NEVER the
    // auth token/signature value itself.
    console.log(JSON.stringify({
      event: 'voice_webhook_received',
      practiceId,
      callSid: req.body?.CallSid,
      provider: provider.providerName,
      signatureValid: verification.valid,
      signatureReason: verification.reason,
    }));

    if (!verification.valid) {
      console.warn(`voicePracticeContext: rejected unverified webhook for practice "${practiceId}" (${verification.reason})`);
      return res.status(403).json({ error: 'Webhook signature verification failed' });
    }

    req.practiceId = practice.practiceId;
    req.practice = practice;
    req.voiceProvider = provider;
    next();
  };
}

module.exports = buildVoicePracticeContext();
module.exports.buildVoicePracticeContext = buildVoicePracticeContext;
module.exports.getPublicRequestUrl = getPublicRequestUrl;
