const test = require('node:test');
const assert = require('node:assert/strict');

const receptionistEngine = require('../services/receptionistEngine');
const emergencyService = require('../services/emergencyService');

const PRACTICE = {
  practiceId: 'test-practice',
  services: [{ id: 'cleaning', name: 'Cleaning', price: 150 }],
};

/** In-memory fake matching repositories/ConversationRepository.js's shape exactly, so tests never touch the real (shared/global) conversation store. */
function makeFakeConversationRepository() {
  const store = new Map();
  const key = (p, c) => `${p}::${c}`;
  return {
    getConversation(practiceId, conversationId) {
      const k = key(practiceId, conversationId);
      if (!store.has(k)) {
        store.set(k, { history: [], slots: { serviceId: null, datePreference: null, patientType: null, language: 'en' } });
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

function fakeAIProvider(result) {
  return { getAIProvider: () => ({ understandAndReply: async () => result }) };
}

test('EMERGENCY BEFORE AI: a life-threatening message short-circuits before any AI call', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  let aiCalled = false;
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    getAIProvider: () => { aiCalled = true; return { understandAndReply: async () => ({}) }; },
  };

  const result = await receptionistEngine.understand(
    { practice: PRACTICE, conversationId: 'c1', message: "I can't breathe", channel: 'voice' },
    deps
  );

  assert.equal(aiCalled, false, 'the AI provider must never be invoked for a life-threatening message');
  assert.equal(result.intent, 'emergency');
  assert.equal(result.urgency, 'life_threatening');
  assert.equal(result.reply, emergencyService.LIFE_THREATENING_MESSAGE_EN);
  assert.ok(result.replyUr);
  assert.deepEqual(result.suggestedActions, ['talk_to_human']);
  assert.ok(analytics.events.some((e) => e.name === 'emergency_request' && e.payload.source === 'keyword'));
});

test('NORMAL FAQ: a plain question calls the AI provider and merges entities into slot memory', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    ...fakeAIProvider({
      language: 'en',
      intent: 'faq',
      entities: { serviceId: 'cleaning', datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
      reply: 'A cleaning is $150.',
      suggestedActions: ['show_prices'],
    }),
  };

  const result = await receptionistEngine.understand(
    { practice: PRACTICE, conversationId: 'c2', message: 'How much is a cleaning?', channel: 'voice' },
    deps
  );

  assert.equal(result.aiFailed, false);
  assert.equal(result.intent, 'faq');
  assert.equal(result.entities.serviceId, 'cleaning');
  assert.equal(convRepo.getConversation('test-practice', 'c2').slots.serviceId, 'cleaning');
});

test('CONVERSATION MEMORY: slots accumulate across turns using the same conversationId', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();

  const deps1 = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    ...fakeAIProvider({
      language: 'en',
      intent: 'book_appointment',
      entities: { serviceId: 'cleaning', datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
      reply: 'Sure. What day works for you?',
      suggestedActions: ['book_appointment'],
    }),
  };
  await receptionistEngine.understand({ practice: PRACTICE, conversationId: 'c3', message: 'I need a cleaning.', channel: 'voice' }, deps1);

  const deps2 = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    ...fakeAIProvider({
      language: 'en',
      intent: 'book_appointment',
      // The AI does not re-mention serviceId this turn (real Gemini behavior for a short follow-up) — the engine must not forget it.
      // Per the AIProvider contract (services/ai/AIProvider.js), a provider always
      // normalizes an unmentioned entity to null before returning it (see
      // GeminiAIProvider's sentinelToNull) — never the raw 'none' sentinel string.
      entities: { serviceId: null, datePreference: 'Friday', patientType: null, urgency: 'none', insuranceProvider: null },
      reply: 'What time on Friday works?',
      suggestedActions: ['book_appointment'],
    }),
  };
  const result2 = await receptionistEngine.understand({ practice: PRACTICE, conversationId: 'c3', message: 'Friday.', channel: 'voice' }, deps2);

  assert.equal(result2.entities.serviceId, 'cleaning', 'earlier-turn serviceId must be carried forward, not erased by a later turn that omits it');
  assert.equal(result2.entities.datePreference, 'Friday');
});

test('AI FAILURE (non-urgent): returns a safe generic reply and marks aiFailed', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    getAIProvider: () => ({ understandAndReply: async () => { throw new Error('provider outage'); } }),
  };

  const result = await receptionistEngine.understand({ practice: PRACTICE, conversationId: 'c4', message: 'What are your hours?', channel: 'voice' }, deps);

  assert.equal(result.aiFailed, true);
  assert.equal(result.urgency, 'none');
  assert.equal(result.reply, receptionistEngine.GENERIC_AI_FAILURE_REPLY_EN);
});

test('AI FAILURE (urgent): falls back to the safety-aware urgent message, never the generic one', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    getAIProvider: () => ({ understandAndReply: async () => { throw new Error('provider outage'); } }),
  };

  const result = await receptionistEngine.understand(
    { practice: PRACTICE, conversationId: 'c5', message: 'I have severe tooth pain', channel: 'voice' },
    deps
  );

  assert.equal(result.aiFailed, true);
  assert.equal(result.urgency, 'urgent');
  assert.equal(result.reply, emergencyService.URGENT_FALLBACK_MESSAGE_EN);
  assert.ok(analytics.events.some((e) => e.payload.source === 'keyword_fallback_on_ai_error'));
});

test('PRACTICE ISOLATION: the same conversationId under two different practices never shares slot memory', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    ...fakeAIProvider({
      language: 'en',
      intent: 'faq',
      entities: { serviceId: 'cleaning', datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
      reply: 'ok',
      suggestedActions: ['none'],
    }),
  };

  await receptionistEngine.understand({ practice: { practiceId: 'practice-a' }, conversationId: 'shared-id', message: 'hi', channel: 'voice' }, deps);
  const resultB = await receptionistEngine.understand({ practice: { practiceId: 'practice-b' }, conversationId: 'shared-id', message: 'hi', channel: 'voice' }, deps);

  assert.equal(convRepo.getConversation('practice-a', 'shared-id').slots.serviceId, 'cleaning');
  assert.equal(resultB.entities.serviceId, 'cleaning'); // practice-b's OWN turn also set it — proves it's a fresh, separate record, not shared state
  // The two conversations must be genuinely separate objects, not aliases of one another.
  assert.notStrictEqual(
    convRepo.getConversation('practice-a', 'shared-id'),
    convRepo.getConversation('practice-b', 'shared-id')
  );
});

test('HUMAN HANDOFF intent logs a human_handoff_requested analytics event', async () => {
  const convRepo = makeFakeConversationRepository();
  const analytics = makeFakeAnalytics();
  const deps = {
    conversationRepository: convRepo,
    analyticsRepository: analytics,
    ...fakeAIProvider({
      language: 'en',
      intent: 'human_handoff',
      entities: { serviceId: null, datePreference: null, patientType: null, urgency: 'none', insuranceProvider: null },
      reply: "Absolutely, I'll connect you with our front desk team.",
      suggestedActions: ['talk_to_human'],
    }),
  };

  await receptionistEngine.understand({ practice: PRACTICE, conversationId: 'c6', message: 'I want to speak to a person', channel: 'voice' }, deps);

  assert.ok(analytics.events.some((e) => e.name === 'human_handoff_requested' && e.payload.source === 'voice_intent'));
});
