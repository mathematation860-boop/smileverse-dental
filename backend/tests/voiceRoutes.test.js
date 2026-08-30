/**
 * routes/voice.js — the thin webhook-to-TwiML adapter layer. These tests
 * inject a fake voicePracticeContext (so practice resolution/signature
 * verification, already covered by tests/voicePracticeContext.test.js,
 * isn't re-tested here), a fake voiceReceptionistEngine, and a fake
 * CallLogRepository, and assert this file does its own actual job
 * correctly: producing the right TwiML shape for each outcome, and
 * recording real call-history facts — never fabricated ones.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { invokeRoute } = require('./helpers/invokeRoute');
const { buildVoiceRouter } = require('../routes/voice');

const PRACTICE = { practiceId: 'test-practice', name: 'SmileVerse Dental', phone: '+15559998888', demoMode: true };

function fakeVoicePracticeContext(req, res, next) {
  req.practiceId = PRACTICE.practiceId;
  req.practice = PRACTICE;
  req.voiceProvider = {
    providerName: 'mock',
    buildSayAndGatherResponse: ({ text, actionUrl }) => `<Gather action="${actionUrl}">${text}</Gather>`,
    buildSayAndHangupResponse: ({ text }) => `<Hangup>${text}</Hangup>`,
    buildTransferResponse: ({ text, transferTo }) => `<Dial to="${transferTo}">${text}</Dial>`,
  };
  next();
}

function fakeVoiceProviders(transcribedText) {
  return { getSpeechToTextProvider: () => ({ transcribe: async () => ({ text: transcribedText, confidence: null }) }) };
}

function fakeCallLogRepository() {
  const calls = new Map();
  return {
    calls,
    startCall: async (practiceId, data) => { calls.set(data.callSid, { practiceId, ...data, turnCount: 0 }); },
    recordTurn: async (callSid, patch = {}) => {
      const call = calls.get(callSid) || {};
      calls.set(callSid, { ...call, ...patch, turnCount: (call.turnCount || 0) + 1 });
    },
    endCall: async (callSid, patch = {}) => {
      const call = calls.get(callSid) || {};
      calls.set(callSid, { ...call, ...patch, ended: true });
    },
  };
}

function fakeReq(body, headers = {}) {
  return { body, headers, get: () => 'example.com', protocol: 'https', originalUrl: '/api/voice/gather' };
}

test('INCOMING CALL: greets with the PRACTICE\'s own name (never hard-coded) and starts a Gather, and logs the call start', async () => {
  const callLogRepository = fakeCallLogRepository();
  const router = buildVoiceRouter({ voicePracticeContext: fakeVoicePracticeContext, callLogRepository });

  const { res } = await invokeRoute(router, 'POST', '/incoming', fakeReq({ CallSid: 'CA1', From: '+15551112222', To: '+15559998888' }));

  assert.match(res.body, /Thank you for calling SmileVerse Dental/);
  assert.match(res.body, /<Gather/);
  assert.ok(callLogRepository.calls.has('CA1'));
});

test('NORMAL TURN: transcribes speech, calls the orchestrator, and continues with another Gather', async () => {
  const callLogRepository = fakeCallLogRepository();
  let engineCalledWith = null;
  const voiceReceptionistEngine = {
    handleTurn: async (args) => { engineCalledWith = args; return { reply: 'A cleaning is $150.', intent: 'faq', urgency: 'none', transfer: false, hangup: false, language: 'en' }; },
  };
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders('how much is a cleaning'),
    voiceReceptionistEngine,
    callLogRepository,
  });

  const { res } = await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA2', From: '+15551112222', SpeechResult: 'how much is a cleaning' }));

  assert.equal(engineCalledWith.utteranceText, 'how much is a cleaning');
  assert.equal(engineCalledWith.conversationId, 'CA2', 'the CallSid must be used as the conversation/session id');
  assert.match(res.body, /<Gather/);
  assert.match(res.body, /A cleaning is \$150\./);
});

test('HUMAN HANDOFF RESULT: builds a transfer TwiML response and marks the call ended', async () => {
  const callLogRepository = fakeCallLogRepository();
  await callLogRepository.startCall(PRACTICE.practiceId, { callSid: 'CA3', fromNumber: '+1555', toNumber: '+15559998888', demoMode: true });
  const voiceReceptionistEngine = {
    handleTurn: async () => ({ reply: "Connecting you now.", intent: 'human_handoff', urgency: 'none', transfer: true, hangup: false, language: 'en' }),
  };
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders('let me talk to a person'),
    voiceReceptionistEngine,
    callLogRepository,
  });

  const { res } = await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA3', From: '+1555', SpeechResult: 'let me talk to a person' }));

  assert.match(res.body, /<Dial to="\+15559998888">/);
  assert.equal(callLogRepository.calls.get('CA3').ended, true);
  assert.equal(callLogRepository.calls.get('CA3').handoffRequested, true);
});

test('EMERGENCY RESULT: builds a hangup TwiML response (never another Gather) after a life-threatening reply', async () => {
  const callLogRepository = fakeCallLogRepository();
  const voiceReceptionistEngine = {
    handleTurn: async () => ({ reply: 'Please call 911 right away.', intent: 'emergency', urgency: 'life_threatening', transfer: false, hangup: true, language: 'en' }),
  };
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders("i can't breathe"),
    voiceReceptionistEngine,
    callLogRepository,
  });

  const { res } = await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA4', From: '+1555', SpeechResult: "i can't breathe" }));

  assert.match(res.body, /<Hangup>/);
  assert.doesNotMatch(res.body, /<Gather/);
});

test('BOOKING CONFIRMED: the call log records appointment_booked ONLY once the flow\'s own confirmation text is seen, never guessed from intent alone', async () => {
  const callLogRepository = fakeCallLogRepository();
  const voiceReceptionistEngine = {
    handleTurn: async () => ({
      reply: "You're all set — your appointment is confirmed for 2026-09-04 at 10:00 AM. We look forward to seeing you.",
      intent: 'voice_flow', urgency: 'none', transfer: false, hangup: false, language: 'en',
    }),
  };
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders('yes please'),
    voiceReceptionistEngine,
    callLogRepository,
  });

  await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA5', From: '+1555', SpeechResult: 'yes please' }));

  assert.equal(callLogRepository.calls.get('CA5').appointmentCreated, true);
  assert.equal(callLogRepository.calls.get('CA5').outcome, 'appointment_booked');
});

test('NO SPEECH DETECTED: re-prompts with another Gather instead of calling the orchestrator with an empty utterance', async () => {
  let engineCalled = false;
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders(''),
    voiceReceptionistEngine: { handleTurn: async () => { engineCalled = true; return {}; } },
    callLogRepository: fakeCallLogRepository(),
  });

  const { res } = await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA6', From: '+1555', SpeechResult: '' }));

  assert.equal(engineCalled, false);
  assert.match(res.body, /<Gather/);
});

test('ENGINE FAILURE: an unexpected error still produces a spoken transfer response, never a raw 500 with dead air', async () => {
  const router = buildVoiceRouter({
    voicePracticeContext: fakeVoicePracticeContext,
    voiceProviders: fakeVoiceProviders('hello'),
    voiceReceptionistEngine: { handleTurn: async () => { throw new Error('boom'); } },
    callLogRepository: fakeCallLogRepository(),
  });

  const { res } = await invokeRoute(router, 'POST', '/gather', fakeReq({ CallSid: 'CA7', From: '+1555', SpeechResult: 'hello' }));

  assert.match(res.body, /<Dial/);
  assert.match(res.body, /trouble right now/);
});

test('STATUS CALLBACK: records the call\'s final status and duration', async () => {
  const callLogRepository = fakeCallLogRepository();
  await callLogRepository.startCall(PRACTICE.practiceId, { callSid: 'CA8', fromNumber: '+1555', toNumber: '+15559998888', demoMode: true });
  const router = buildVoiceRouter({ voicePracticeContext: fakeVoicePracticeContext, callLogRepository });

  const { res } = await invokeRoute(router, 'POST', '/status', fakeReq({ CallSid: 'CA8', CallStatus: 'completed', CallDuration: '47' }));

  assert.equal(res.statusCode, 200);
  assert.equal(callLogRepository.calls.get('CA8').status, 'completed');
  assert.equal(callLogRepository.calls.get('CA8').durationSeconds, 47);
});
