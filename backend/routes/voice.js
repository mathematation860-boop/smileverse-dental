/**
 * Voice (telephone) channel — the webhook endpoints a telephony provider
 * (Twilio, in production; the mock provider in every practice's default
 * demoMode) calls as a call progresses. This file is deliberately thin:
 * all it does is (1) trust the practice/signature verification
 * middleware.voicePracticeContext.js already did, (2) transcribe via the
 * SpeechToTextProvider interface, (3) hand the utterance to
 * services/voice/voiceReceptionistEngine.js — the ONE place actual
 * receptionist intelligence lives — and (4) turn its result into TwiML
 * via the TelephonyProvider interface. No business logic (booking rules,
 * emergency detection, FAQ answers) is duplicated here.
 *
 * `buildVoiceRouter(deps)` mirrors the Phase 3 admin routers' DI pattern
 * (see routes/adminHandoffs.js) so every collaborator — the practice-
 * context middleware, the provider factories, the orchestrator, and the
 * CallLog repository — can be swapped for a fake in tests without an HTTP
 * server, a database, or a real Twilio/Gemini credential — see
 * tests/voiceRoutes.test.js.
 */

const express = require('express');
const voicePracticeContextReal = require('../middleware/voicePracticeContext');
const voiceProvidersReal = require('../services/voice');
const voiceReceptionistEngineReal = require('../services/voice/voiceReceptionistEngine');
const callLogRepositoryReal = require('../repositories/CallLogRepository');

const MAX_SPEECH_LENGTH = 2000; // defensive cap — never forward unbounded input to the AI provider

function buildVoiceRouter(deps = {}) {
  const voicePracticeContext = deps.voicePracticeContext || voicePracticeContextReal;
  const voiceProviders = deps.voiceProviders || voiceProvidersReal;
  const voiceReceptionistEngine = deps.voiceReceptionistEngine || voiceReceptionistEngineReal;
  const callLogRepository = deps.callLogRepository || callLogRepositoryReal;

  const router = express.Router();
  router.use(voicePracticeContext);

  function gatherActionUrl(req) {
    // Relative-to-absolute the same way voicePracticeContext resolved the
    // incoming URL, so the <Gather>/<Redirect> action Twilio calls next
    // lands back on this same, correctly-signed endpoint.
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const host = (req.headers['x-forwarded-host'] || req.get('host') || '').split(',')[0].trim();
    return `${proto}://${host}/api/voice/gather`;
  }

  // POST /api/voice/incoming — the telephony provider's "a call arrived" webhook.
  router.post('/incoming', async (req, res) => {
    const practice = req.practice;
    const provider = req.voiceProvider;
    const callSid = req.body.CallSid || `mock-${Date.now()}`;
    const fromNumber = req.body.From || null;
    const toNumber = req.body.To || null;

    try {
      await callLogRepository.startCall(practice.practiceId, {
        callSid, fromNumber, toNumber, demoMode: practice.demoMode !== false,
      });
    } catch (err) {
      console.error('voice/incoming: failed to log call start (non-fatal):', err.message);
    }

    // Practice-grounded, never hard-coded (Phase 4 spec §4) — the SAME
    // practice.name every other channel/route already reads off req.practice.
    const greeting = `Thank you for calling ${practice.name}. How can I help you today?`;

    console.log(JSON.stringify({ event: 'voice_call_started', practiceId: practice.practiceId, callSid, provider: provider.providerName }));

    const twiml = provider.buildSayAndGatherResponse({ text: greeting, actionUrl: gatherActionUrl(req), language: 'en' });
    res.type('text/xml').send(twiml);
  });

  // POST /api/voice/gather — the telephony provider's "here's what the caller said" webhook.
  router.post('/gather', async (req, res) => {
    const practice = req.practice;
    const provider = req.voiceProvider;
    const callSid = req.body.CallSid || 'unknown-call';
    const fromNumber = req.body.From || null;

    try {
      const speechProvider = voiceProviders.getSpeechToTextProvider(practice);
      const transcript = await speechProvider.transcribe({ text: req.body.SpeechResult });
      const utteranceText = (transcript.text || '').slice(0, MAX_SPEECH_LENGTH);

      if (!utteranceText) {
        // Gather's own no-speech Redirect already re-asks once (see
        // twimlBuilder.buildSayAndGather) — if we land here anyway, ask
        // again rather than silently ending the call.
        const twiml = provider.buildSayAndGatherResponse({
          text: "Sorry, I didn't catch that — could you say that again?",
          actionUrl: gatherActionUrl(req),
          language: 'en',
        });
        return res.type('text/xml').send(twiml);
      }

      const result = await voiceReceptionistEngine.handleTurn({
        practice, conversationId: callSid, callerPhone: fromNumber, utteranceText,
      });

      try {
        await callLogRepository.recordTurn(callSid, {
          outcome:
            result.intent === 'emergency' ? 'emergency' :
            result.transfer ? 'human_handoff' :
            undefined, // booking/cancel/reschedule outcomes are set by the AFTER-confirmation branch below, from the ACTUAL flow reply — never guessed from intent alone
          appointmentCreated: /confirmed for|you're all set/i.test(result.reply || ''),
          handoffRequested: !!result.transfer,
          emergencyDetected: result.intent === 'emergency',
        });
        if (/appointment has been cancelled/i.test(result.reply || '')) {
          await callLogRepository.recordTurn(callSid, { outcome: 'appointment_cancelled' });
        } else if (/is now on/i.test(result.reply || '')) {
          await callLogRepository.recordTurn(callSid, { outcome: 'appointment_rescheduled' });
        } else if (/confirmed for|you're all set/i.test(result.reply || '')) {
          await callLogRepository.recordTurn(callSid, { outcome: 'appointment_booked' });
        }
      } catch (err) {
        console.error('voice/gather: failed to record call turn (non-fatal):', err.message);
      }

      console.log(JSON.stringify({
        event: 'voice_turn_handled', practiceId: practice.practiceId, callSid,
        intent: result.intent, urgency: result.urgency, transfer: result.transfer, hangup: result.hangup,
      }));

      let twiml;
      if (result.transfer) {
        twiml = provider.buildTransferResponse({ text: result.reply, transferTo: practice.phone, language: result.language });
        try { await callLogRepository.endCall(callSid, { status: 'completed' }); } catch (err) { /* non-fatal */ }
      } else if (result.hangup) {
        twiml = provider.buildSayAndHangupResponse({ text: result.reply, language: result.language });
        try { await callLogRepository.endCall(callSid, { status: 'completed' }); } catch (err) { /* non-fatal */ }
      } else {
        twiml = provider.buildSayAndGatherResponse({ text: result.reply, actionUrl: gatherActionUrl(req), language: result.language });
      }
      res.type('text/xml').send(twiml);
    } catch (err) {
      // Never silently fail and never leave the caller with dead air
      // (Phase 4 spec §14) — a genuine, unexpected server error still gets
      // a spoken, honest response offering a human instead.
      console.error('voice/gather: unexpected error handling turn:', err.message);
      const twiml = provider.buildTransferResponse({
        text: "I'm sorry, I'm having trouble right now.",
        transferTo: practice.phone,
        language: 'en',
      });
      try { await callLogRepository.endCall(callSid, { status: 'failed' }); } catch (logErr) { /* non-fatal */ }
      res.type('text/xml').send(twiml);
    }
  });

  // POST /api/voice/status — the telephony provider's call-status callback (call ended/failed/no-answer/busy).
  router.post('/status', async (req, res) => {
    const callSid = req.body.CallSid;
    const statusMap = { completed: 'completed', failed: 'failed', busy: 'busy', 'no-answer': 'no_answer', canceled: 'failed' };
    const status = statusMap[req.body.CallStatus] || undefined;
    const durationSeconds = req.body.CallDuration !== undefined ? Number(req.body.CallDuration) : undefined;

    try {
      if (callSid) await callLogRepository.endCall(callSid, { status, durationSeconds });
    } catch (err) {
      console.error('voice/status: failed to record call end (non-fatal):', err.message);
    }

    console.log(JSON.stringify({ event: 'voice_call_ended', practiceId: req.practiceId, callSid, status: req.body.CallStatus }));
    res.sendStatus(200);
  });

  return router;
}

module.exports = buildVoiceRouter();
module.exports.buildVoiceRouter = buildVoiceRouter;
