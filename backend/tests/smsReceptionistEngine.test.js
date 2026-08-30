/**
 * services/sms/smsReceptionistEngine.js (Phase 5 spec §11/§27) — mirrors
 * tests/voiceReceptionistEngine.test.js's structure closely, since this
 * module deliberately reuses the exact same building blocks (see that
 * file's own header comment on why).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const smsReceptionistEngine = require('../services/sms/smsReceptionistEngine');
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

function makeFakeConversationRepository(seed = {}) {
  const store = new Map();
  const key = (p, c) => `${p}::${c}`;
  return {
    getConversation(practiceId, conversationId) {
      const k = key(practiceId, conversationId);
      if (!store.has(k)) store.set(k, { history: [], slots: freshSlots(seed[conversationId] || {}) });
      return store.get(k);
    },
    appendMessage(practiceId, conversationId, role, content) {
      this.getConversation(practiceId, conversationId).history.push({ role, content });
    },
    updateSlots(practiceId, conversationId, partial) {
      const conv = this.getConversation(practiceId, conversationId);
      Object.entries(partial).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== '') conv.slots[k] = v; });
      return conv.slots;
    },
  };
}

function fakeNotificationService() {
  const calls = [];
  return { calls, notifyEmergencyClinicAlert: async (practice, args) => { calls.push(args); return new Promise(() => {}); } };
}

test('conversationIdForSms is stable per phone number and distinct from a voice CallSid namespace', () => {
  const id1 = smsReceptionistEngine.conversationIdForSms('+1 (555) 123-4567');
  const id2 = smsReceptionistEngine.conversationIdForSms('15551234567');
  assert.equal(id1, id2, 'the same number in different formats must resolve to the same conversation');
  assert.match(id1, /^sms:/);
});

test('EMERGENCY BEFORE ANYTHING: a life-threatening text short-circuits before the shared AI engine, and pages the clinic without blocking', async () => {
  const convRepo = makeFakeConversationRepository();
  const notificationService = fakeNotificationService();
  let engineCalled = false;
  const deps = {
    conversationRepository: convRepo,
    receptionistEngine: { understand: async () => { engineCalled = true; return {}; } },
    notificationService,
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: "I can't breathe" }, deps);

  assert.equal(engineCalled, false);
  assert.equal(result.reply, emergencyService.LIFE_THREATENING_MESSAGE_EN);
  assert.equal(notificationService.calls.length, 1);
});

test('EMERGENCY INTERRUPTS AN IN-PROGRESS FLOW: never lets a booking flow swallow a life-threatening text', async () => {
  const convRepo = makeFakeConversationRepository({
    'sms:15551112222': { voicePendingAction: 'book', voiceStep: 'collect_time', serviceId: 'cleaning', voiceResolvedDate: '2026-09-04' },
  });
  let flowCalled = false;
  const deps = {
    conversationRepository: convRepo,
    voiceBookingFlow: { continueFlow: async () => { flowCalled = true; return { reply: 'x' }; } },
    notificationService: fakeNotificationService(),
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: 'severe uncontrollable bleeding' }, deps);

  assert.equal(flowCalled, false);
  assert.equal(result.reply, emergencyService.LIFE_THREATENING_MESSAGE_EN);
  const conv = convRepo.getConversation('test-practice', 'sms:15551112222');
  assert.equal(conv.slots.voicePendingAction, null, 'the in-progress flow must be cleared');
});

test('FLOW CONTINUATION BYPASSES THE AI: an in-progress flow goes straight to voiceBookingFlow, not the shared engine', async () => {
  const convRepo = makeFakeConversationRepository({
    'sms:15551112222': { voicePendingAction: 'book', voiceStep: 'collect_date' },
  });
  let engineCalled = false;
  let flowArgs = null;
  const deps = {
    conversationRepository: convRepo,
    receptionistEngine: { understand: async () => { engineCalled = true; return {}; } },
    voiceBookingFlow: { continueFlow: async (args) => { flowArgs = args; return { reply: 'What day works?' }; } },
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: 'Friday' }, deps);

  assert.equal(engineCalled, false);
  assert.ok(flowArgs);
  assert.equal(result.reply, 'What day works?');
});

test('AI-DETECTED book_appointment INTENT starts the deterministic flow — reuses voiceBookingFlow, no second AI/booking implementation', async () => {
  const convRepo = makeFakeConversationRepository();
  let startFlowCalled = false;
  const deps = {
    conversationRepository: convRepo,
    receptionistEngine: { understand: async () => ({ intent: 'book_appointment', urgency: 'none', reply: 'ai reply', entities: {} }) },
    voiceBookingFlow: { startFlow: async () => { startFlowCalled = true; return { reply: 'Which service would you like?' }; } },
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: 'I want to book an appointment' }, deps);

  assert.equal(startFlowCalled, true);
  assert.equal(result.reply, 'Which service would you like?');
});

test('HUMAN HANDOFF intent creates a real handoff record via the shared tool (no separate implementation)', async () => {
  const convRepo = makeFakeConversationRepository();
  let handoffCalledWith = null;
  const deps = {
    conversationRepository: convRepo,
    receptionistEngine: { understand: async () => ({ intent: 'human_handoff', urgency: 'none', reply: 'Our team will follow up.', entities: {} }) },
    request_human_handoff: async (practice, data) => { handoffCalledWith = data; return { _id: 'h1' }; },
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: 'let me talk to someone' }, deps);

  assert.ok(handoffCalledWith);
  assert.equal(handoffCalledWith.type, 'send_message');
  assert.equal(result.reply, 'Our team will follow up.');
});

test('GENERAL / FAQ passthrough: a plain question returns the shared engine\'s reply verbatim', async () => {
  const convRepo = makeFakeConversationRepository();
  const deps = {
    conversationRepository: convRepo,
    receptionistEngine: { understand: async () => ({ intent: 'faq', urgency: 'none', reply: 'We accept most major insurance plans.', entities: {} }) },
  };

  const result = await smsReceptionistEngine.handleMessage({ practice: PRACTICE, fromNumber: '+15551112222', messageText: 'do you take insurance?' }, deps);

  assert.equal(result.reply, 'We accept most major insurance plans.');
});
