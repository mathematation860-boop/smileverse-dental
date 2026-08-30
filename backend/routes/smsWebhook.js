/**
 * SMS (text messaging) channel — the webhook endpoints an SMS provider
 * (Twilio, in production; the mock provider in every practice's default
 * demoMode — see services/notifications/index.js) calls when a patient
 * texts in, or when a delivery status update is available for a text this
 * app sent (Phase 5 spec §11/§21).
 *
 * Deliberately thin, mirroring routes/voice.js's own header comment: this
 * file trusts the practice/signature verification middleware.smsPracticeContext.js
 * already did, hands the message to services/sms/smsReceptionistEngine.js
 * — the ONE place SMS conversational logic lives, itself built on the
 * SAME shared tools/engine web and voice already use — and turns the
 * result into Messaging TwiML.
 *
 * `buildSmsRouter(deps)` mirrors every other Phase 3/4 router's DI pattern
 * so every collaborator can be swapped for a fake in tests.
 */

const express = require('express');
const smsPracticeContextReal = require('../middleware/smsPracticeContext');
const smsReceptionistEngineReal = require('../services/sms/smsReceptionistEngine');
const twimlBuilder = require('../services/voice/twimlBuilder');
const notificationLogRepositoryReal = require('../repositories/NotificationLogRepository');

const MAX_MESSAGE_LENGTH = 1600; // Twilio's own long-SMS concatenation cap area — defensive bound before ever forwarding to the AI

// Twilio's own delivery-status vocabulary -> this app's NotificationLog status.
const STATUS_MAP = {
  delivered: 'sent',
  sent: 'sent',
  failed: 'failed',
  undelivered: 'failed',
};

function buildSmsRouter(deps = {}) {
  const smsPracticeContext = deps.smsPracticeContext || smsPracticeContextReal;
  const smsReceptionistEngine = deps.smsReceptionistEngine || smsReceptionistEngineReal;
  const notificationLogRepository = deps.notificationLogRepository || notificationLogRepositoryReal;

  const router = express.Router();
  router.use(smsPracticeContext);

  // POST /api/sms/incoming — a patient texted in.
  router.post('/incoming', async (req, res) => {
    const practice = req.practice;
    const fromNumber = req.body.From || null;
    const messageBody = (req.body.Body || '').slice(0, MAX_MESSAGE_LENGTH);

    if (!fromNumber || !messageBody) {
      // Nothing to reply to meaningfully — an empty/malformed webhook.
      return res.type('text/xml').send(twimlBuilder.buildMessagingResponse({ text: '' }));
    }

    try {
      const result = await smsReceptionistEngine.handleMessage({ practice, fromNumber, messageText: messageBody });
      console.log(JSON.stringify({ event: 'sms_turn_handled', practiceId: practice.practiceId, messageSid: req.body.MessageSid || null }));
      res.type('text/xml').send(twimlBuilder.buildMessagingResponse({ text: result.reply }));
    } catch (err) {
      // Never silently fail — a genuine, unexpected error still gets an
      // honest, safe reply rather than a raw 500 (spec §14/§25's spirit,
      // matching routes/voice.js's own ENGINE FAILURE handling).
      console.error('sms/incoming: unexpected error handling message:', err.message);
      res.type('text/xml').send(
        twimlBuilder.buildMessagingResponse({
          text: `I'm sorry, I'm having trouble right now. Please call us at ${practice.phone} and our team will help you.`,
        })
      );
    }
  });

  // POST /api/sms/status — delivery status callback for an OUTBOUND text
  // this app sent (see services/notifications/TwilioSMSProvider.js's
  // optional statusCallback). Updates the matching NotificationLog record;
  // naturally idempotent (see repository) against Twilio's own webhook
  // retries — never processes the same status update into a duplicate row.
  router.post('/status', async (req, res) => {
    const messageSid = req.body.MessageSid || req.body.SmsSid;
    const twilioStatus = req.body.MessageStatus;
    const mappedStatus = STATUS_MAP[twilioStatus];

    try {
      if (messageSid && mappedStatus) {
        await notificationLogRepository.updateStatusByProviderMessageId(req.practiceId, messageSid, {
          status: mappedStatus,
          providerStatus: twilioStatus,
          failureReason: mappedStatus === 'failed' ? `twilio_status_${twilioStatus}` : undefined,
        });
      }
    } catch (err) {
      console.error('sms/status: failed to record delivery status (non-fatal):', err.message);
    }

    console.log(JSON.stringify({ event: 'sms_status_received', practiceId: req.practiceId, messageSid, status: twilioStatus }));
    res.sendStatus(200);
  });

  return router;
}

module.exports = buildSmsRouter();
module.exports.buildSmsRouter = buildSmsRouter;
