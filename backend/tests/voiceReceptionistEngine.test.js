const test = require('node:test');
const assert = require('node:assert/strict');

const voiceReceptionistEngine = require('../services/voice/voiceReceptionistEngine');
const emergencyService = require('../services/emergencyService');

const PRACTICE = { practiceId: 'test-practice', phone: '+15550009999' };

function freshSlots(overrides = {}) {
  return {
    serviceId: null, datePreference: null, patientType: null, name: null, phone: null,
    email: null, language: 'en', urgency: null,
    voicePendingAction: null, voiceStep: null, voiceTargetAppointmentId: null,
    voiceResolvedDate: null, voiceResolvedTime: null, voiceStepAttempts: 0,
    ...overrides,
  };
}

/** Matches repositories/ConversationRepository.js's shape, seeded with the FULL voice-aware slot set (see services/conversationStore.js EMPTY_SLOTS). */
function makeFakeConversationRepository(seed = {}) {
  const store = new Map();
  const key = (p, c) => `${p}::${c}`;
  return {
    getConversation(practiceId, conversationId) {
      const k = key(practiceId, conversationId);
      if (!store.has(k)) {
        store.set(k, { history: [], slots: freshSlots(seed[conversationId] || {}) });
      }
      return store.get(k);
    },
    appendMessage(practiceId, conversationId, role, content) {
      this.getConversation(practiceId, conversationId).history.push({ role, content });
    },
    updateSlots(practiceId, conversationId, partial) {
      const conv = this.getConversation(practiceId, conversationId);
      Object.entries(partial).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') conv.slots[k] = v;
      });
      return conv.slots;
    },
  };
}

function makeFakeAnalytics() {
  const events = [];
  return { events, logEvent: async (practiceId, name, conversationId, payload) => { events.push({ practiceId, name, conversationId, payload }); } };
}

function fakeEngine(result) {
  return { understand: async () => result };
}

/** Never-resolving fake (Phase 5 spec §16) — proves handleTurn() never awaits the clinic alert, so a hanging notification provider could never delay a caller's emergency response. */
function fakeNotificationService() {
  const calls = [];
  return {
    calls,
    notifyEmergencyClinicAlert: async (practice, args) => {
      calls.push({ practice, args });
      return new Promise(() => {});
    },
  };
}

test('EMERGENCY BEFORE ANYTHING (no flow in progress): short-circuits before the shared AI engine is ever called', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const notificationService = fakeNotificationService();
  let engineCalled = false;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: { understand: async () => { engineCalled = true; return {}; } },
    notificationService,
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call1', callerPhone: '+15551112222', utteranceText: "I can't breathe" },
    deps
  );

  assert.equal(engineCalled, false, 'the shared AI engine must never be invoked for a life-threatening utterance');
  assert.equal(result.intent, 'emergency');
  assert.equal(result.urgency, 'life_threatening');
  assert.equal(result.reply, emergencyService.LIFE_THREATENING_MESSAGE_EN);
  assert.ok(result.replyUr);
  assert.ok(analytics.events.some((e) => e.name === 'emergency_request' && e.payload.channel === 'voice'));
  assert.equal(notificationService.calls.length, 1, 'the clinic emergency alert must be attempted exactly once, without blocking this already-returned response');
});

test('EMERGENCY INTERRUPTS AN IN-PROGRESS BOOKING FLOW: never lets the flow swallow a life-threatening utterance', async () => {
  const convRepo = makeFakeConversationRepository({
    call2: { voicePendingAction: 'book', voiceStep: 'collect_time', serviceId: 'cleaning', voiceResolvedDate: '2026-09-04' },
  });
  const analytics = makeFakeAnalytics();
  let flowCalled = false;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    voiceBookingFlow: { continueFlow: async () => { flowCalled = true; return { reply: 'x' }; } },
    notificationService: fakeNotificationService(),
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call2', callerPhone: '+15551112222', utteranceText: 'severe swelling and I feel like passing out, unconscious' },
    deps
  );

  assert.equal(flowCalled, false, 'the booking flow must never process a life-threatening utterance');
  assert.equal(result.intent, 'emergency');
  assert.equal(result.urgency, 'life_threatening');
  const conv = convRepo.getConversation('test-practice', 'call2');
  assert.equal(conv.slots.voicePendingAction, null, 'the in-progress flow must be cleared when an emergency interrupts it');
});

test('FLOW CONTINUATION BYPASSES THE AI: an in-progress flow never re-invokes the shared engine', async () => {
  const convRepo = makeFakeConversationRepository({
    call3: { voicePendingAction: 'book', voiceStep: 'collect_date' },
  });
  const analytics = makeFakeAnalytics();
  let engineCalled = false;
  let flowCalled = false;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: { understand: async () => { engineCalled = true; return {}; } },
    voiceBookingFlow: { continueFlow: async ({ utteranceText }) => { flowCalled = true; return { reply: `you said ${utteranceText}` }; } },
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call3', callerPhone: '+15551112222', utteranceText: 'Friday' },
    deps
  );

  assert.equal(engineCalled, false);
  assert.equal(flowCalled, true);
  assert.equal(result.reply, 'you said Friday');
  assert.equal(result.language, 'en');
});

test('AI-DETECTED book_appointment INTENT STARTS THE DETERMINISTIC FLOW: the flow\'s own first question is spoken, not the AI\'s own reply text', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  let startFlowCalledWith = null;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: fakeEngine({
      reply: 'Sure, I can help with booking.', replyUr: null, intent: 'book_appointment', urgency: 'none',
      suggestedActions: ['book_appointment'], entities: {}, language: 'en', aiFailed: false,
    }),
    voiceBookingFlow: {
      startFlow: async (args) => { startFlowCalledWith = args; return { reply: 'Which service would you like to book?' }; },
    },
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call4', callerPhone: '+15551112222', utteranceText: 'I want to book an appointment' },
    deps
  );

  assert.ok(startFlowCalledWith, 'voiceBookingFlow.startFlow must be invoked');
  assert.equal(startFlowCalledWith.action, 'book');
  assert.equal(result.reply, 'Which service would you like to book?', 'the flow\'s structured question must be spoken, since a phone call has no booking UI to defer to');
  assert.equal(result.transfer, false);
});

test('AI-DETECTED human_handoff INTENT transfers the call and creates a REAL handoff record (unlike web, which only shows a button)', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  let handoffCalledWith = null;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: fakeEngine({
      reply: "Absolutely, I'll connect you with our front desk team.", replyUr: null, intent: 'human_handoff', urgency: 'none',
      suggestedActions: ['talk_to_human'], entities: {}, language: 'en', aiFailed: false,
    }),
    request_human_handoff: async (practice, data) => { handoffCalledWith = data; return { _id: 'h1' }; },
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call5', callerPhone: '+15551112222', utteranceText: 'can I talk to a real person' },
    deps
  );

  assert.ok(handoffCalledWith, 'request_human_handoff must actually be called for voice, not just suggested');
  assert.equal(handoffCalledWith.type, 'call_office');
  assert.equal(handoffCalledWith.phone, '+15551112222');
  assert.equal(result.transfer, true);
});

test('GENERAL / FAQ PASSTHROUGH: a plain question returns the shared engine\'s reply verbatim, with no flow or transfer', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: fakeEngine({
      reply: 'A cleaning is $150.', replyUr: null, intent: 'faq', urgency: 'none',
      suggestedActions: ['show_prices'], entities: { serviceId: 'cleaning' }, language: 'en', aiFailed: false,
    }),
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call6', callerPhone: '+15551112222', utteranceText: 'how much is a cleaning' },
    deps
  );

  assert.equal(result.reply, 'A cleaning is $150.');
  assert.equal(result.intent, 'faq');
  assert.equal(result.transfer, false);
  assert.equal(result.hangup, false);
});

test('URGENT-BUT-NOT-LIFE-THREATENING AI FAILURE: falls back through the same pathway chat uses, never claims false success', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    receptionistEngine: fakeEngine({
      reply: emergencyService.URGENT_FALLBACK_MESSAGE_EN, replyUr: emergencyService.URGENT_FALLBACK_MESSAGE_UR,
      intent: 'emergency', urgency: 'urgent', suggestedActions: ['talk_to_human'], entities: {}, language: 'en', aiFailed: true,
    }),
  };

  const result = await voiceReceptionistEngine.handleTurn(
    { practice: PRACTICE, conversationId: 'call7', callerPhone: '+15551112222', utteranceText: 'I have severe tooth pain' },
    deps
  );

  assert.equal(result.reply, emergencyService.URGENT_FALLBACK_MESSAGE_EN);
  assert.equal(result.urgency, 'urgent');
  assert.equal(result.transfer, false);
});
