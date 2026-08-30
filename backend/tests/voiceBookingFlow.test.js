const test = require('node:test');
const assert = require('node:assert/strict');

const voiceBookingFlow = require('../services/voice/voiceBookingFlow');

const PRACTICE = {
  practiceId: 'test-practice',
  timezone: 'America/New_York',
  hours: {
    openDays: [0, 1, 2, 3, 4, 5, 6],
    openTime: '09:00',
    closeTime: '17:00',
    slotMinutes: 30,
  },
  services: [
    { id: 'cleaning', name: 'Cleaning', price: 150 },
    { id: 'whitening', name: 'Whitening', price: 200 },
  ],
};

function freshSlots() {
  return {
    serviceId: null, datePreference: null, patientType: null, name: null, phone: null,
    voicePendingAction: null, voiceStep: null, voiceTargetAppointmentId: null,
    voiceResolvedDate: null, voiceResolvedTime: null, voiceStepAttempts: 0,
  };
}

test('BOOKING SUCCESS: walks service -> date -> time -> name -> confirm -> create_appointment, and never claims success before the provider confirms', async () => {
  const conv = { slots: freshSlots() };
  let created = null;
  const deps = {
    check_availability: async () => ({ slots: [{ time: '10:00 AM', minutes: 600 }, { time: '2:00 PM', minutes: 840 }] }),
    create_appointment: async (practice, data) => { created = data; return { _id: 'apt1', date: data.date, time: data.time }; },
  };

  let r = await voiceBookingFlow.startFlow({ practice: PRACTICE, action: 'book', conv, callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.match(r.reply, /which service/i);

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'a cleaning please', callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.equal(conv.slots.serviceId, 'cleaning');
  assert.match(r.reply, /what day/i);

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'Friday', callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.ok(conv.slots.voiceResolvedDate);
  assert.match(r.reply, /openings/i);

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: '2pm', callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.equal(conv.slots.voiceResolvedTime, '2:00 PM');
  assert.match(r.reply, /name/i);

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'Muhammad Ali', callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.equal(conv.slots.name, 'Muhammad Ali');
  assert.match(r.reply, /shall i book it/i);
  assert.equal(created, null, 'create_appointment must not be called before the caller explicitly confirms');

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'yes please', callerPhone: '+15551234567', conversationId: 'call1', deps });
  assert.ok(created, 'create_appointment must be called only after explicit confirmation');
  assert.equal(created.serviceId, 'cleaning');
  assert.equal(created.phone, '+15551234567');
  assert.match(r.reply, /confirmed/i);
  assert.equal(conv.slots.voicePendingAction, null, 'flow state must be cleared once the booking completes');
});

test('BOOKING NEVER CLAIMS SUCCESS ON PROVIDER FAILURE: create_appointment throwing produces the required fallback line, not a false confirmation', async () => {
  const conv = { slots: freshSlots() };
  conv.slots.serviceId = 'cleaning';
  conv.slots.voicePendingAction = 'book';
  conv.slots.voiceStep = 'confirm';
  conv.slots.voiceResolvedDate = '2026-09-04';
  conv.slots.voiceResolvedTime = '10:00 AM';
  conv.slots.name = 'Test Patient';

  const deps = {
    create_appointment: async () => { throw new Error('provider down'); },
  };

  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'yes', callerPhone: '+15550000000', conversationId: 'call2', deps });

  assert.doesNotMatch(r.reply, /you'?re all set|confirmed/i);
  assert.match(r.reply, /trouble completing that appointment/i);
  assert.equal(r.transfer, true);
});

test('CANCEL SUCCESS: locates the caller\'s single upcoming appointment by phone and cancels only after confirmation', async () => {
  const conv = { slots: freshSlots() };
  let cancelledId = null;
  const deps = {
    search_appointments: async () => [{ _id: 'apt9', service: 'Cleaning', date: '2026-09-10', time: '9:00 AM', status: 'Scheduled' }],
    cancel_appointment: async (practice, id) => { cancelledId = id; return { _id: id }; },
  };

  const started = await voiceBookingFlow.startFlow({ practice: PRACTICE, action: 'cancel', conv, callerPhone: '+15559999999', conversationId: 'call3', deps });
  assert.match(started.reply, /cancel it/i);
  assert.equal(conv.slots.voiceTargetAppointmentId, 'apt9');

  const confirmed = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'yes, cancel it', callerPhone: '+15559999999', conversationId: 'call3', deps });
  assert.equal(cancelledId, 'apt9');
  assert.match(confirmed.reply, /cancelled/i);
});

test('CANCEL — NO MATCHING APPOINTMENT: never invents an appointment to cancel', async () => {
  const conv = { slots: freshSlots() };
  const deps = { search_appointments: async () => [] };

  const r = await voiceBookingFlow.startFlow({ practice: PRACTICE, action: 'cancel', conv, callerPhone: '+15550000001', conversationId: 'call4', deps });
  assert.match(r.reply, /don'?t see any upcoming appointments/i);
  assert.equal(conv.slots.voicePendingAction, null);
});

test('RESCHEDULE SUCCESS: locates target appointment, collects a new date/time, and only reschedules on confirmation', async () => {
  const conv = { slots: freshSlots() };
  let rescheduled = null;
  const deps = {
    search_appointments: async () => [{ _id: 'apt5', service: 'Whitening', date: '2026-09-05', time: '11:00 AM', status: 'Scheduled' }],
    check_availability: async () => ({ slots: [{ time: '1:00 PM', minutes: 780 }] }),
    reschedule_appointment: async (practice, id, { date, time }) => { rescheduled = { id, date, time }; return { _id: id, date, time }; },
  };

  await voiceBookingFlow.startFlow({ practice: PRACTICE, action: 'reschedule', conv, callerPhone: '+15551112222', conversationId: 'call5', deps });
  assert.equal(conv.slots.voiceStep, 'collect_date');

  await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'Monday', callerPhone: '+15551112222', conversationId: 'call5', deps });
  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: '1pm', callerPhone: '+15551112222', conversationId: 'call5', deps });
  assert.match(r.reply, /is that correct/i);

  const confirmed = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'yes', callerPhone: '+15551112222', conversationId: 'call5', deps });
  assert.equal(rescheduled.id, 'apt5');
  assert.equal(rescheduled.time, '1:00 PM');
  assert.match(confirmed.reply, /now on/i);
});

test('HUMAN HANDOFF mid-flow: caller asking for a person exits the flow and requests a transfer', async () => {
  const conv = { slots: freshSlots() };
  conv.slots.voicePendingAction = 'book';
  conv.slots.voiceStep = 'collect_service';
  let handoffLogged = false;
  const deps = { request_human_handoff: async () => { handoffLogged = true; return {}; } };

  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'can I talk to a person instead', callerPhone: '+15550001111', conversationId: 'call6', deps });

  assert.equal(handoffLogged, true);
  assert.equal(r.transfer, true);
  assert.equal(conv.slots.voicePendingAction, null);
});

test('ABORT: "never mind" clears the flow without executing any tool', async () => {
  const conv = { slots: freshSlots() };
  conv.slots.voicePendingAction = 'book';
  conv.slots.voiceStep = 'collect_date';
  let toolCalled = false;
  const deps = { create_appointment: async () => { toolCalled = true; } };

  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'never mind', callerPhone: '+1555', conversationId: 'call7', deps });

  assert.equal(toolCalled, false);
  assert.equal(conv.slots.voicePendingAction, null);
  assert.match(r.reply, /stopped/i);
});

test('CONFIRMATION "no" cancels the pending action without executing any tool', async () => {
  const conv = { slots: freshSlots() };
  conv.slots.voicePendingAction = 'book';
  conv.slots.voiceStep = 'confirm';
  conv.slots.serviceId = 'cleaning';
  conv.slots.voiceResolvedDate = '2026-09-04';
  conv.slots.voiceResolvedTime = '10:00 AM';
  conv.slots.name = 'Test';
  let toolCalled = false;
  const deps = { create_appointment: async () => { toolCalled = true; } };

  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'no, that\'s wrong', callerPhone: '+1555', conversationId: 'call8', deps });

  assert.equal(toolCalled, false);
  assert.equal(conv.slots.voicePendingAction, null);
});

test('REPEATED UNPARSEABLE ANSWERS escalate to a human handoff rather than looping forever', async () => {
  const conv = { slots: freshSlots() };
  conv.slots.voicePendingAction = 'book';
  conv.slots.voiceStep = 'collect_service';
  let handoffLogged = false;
  const deps = { request_human_handoff: async () => { handoffLogged = true; return {}; } };

  await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'blah blah', callerPhone: '+1555', conversationId: 'call9', deps });
  await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'still unclear', callerPhone: '+1555', conversationId: 'call9', deps });
  const r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'yet again unclear', callerPhone: '+1555', conversationId: 'call9', deps });

  assert.equal(handoffLogged, true);
  assert.equal(r.transfer, true);
});

test('LANGUAGE COVERAGE: yes/no/human-request are all recognized in English, Roman Urdu, and Urdu script (Phase 4 spec §16)', () => {
  for (const yes of ['yes please', 'sure', "that's right", 'haan', 'ji', 'theek hai', 'ہاں', 'جی']) {
    assert.equal(voiceBookingFlow.isAffirmative(yes), true, `expected "${yes}" to be recognized as affirmative`);
  }
  for (const no of ['no', "that's wrong", 'nahi', 'نہیں']) {
    assert.equal(voiceBookingFlow.isNegative(no), true, `expected "${no}" to be recognized as negative`);
  }
  for (const human of ['can I talk to a person', 'a real human please', 'kisi se baat karni hai', 'انسان سے بات کرنی ہے']) {
    assert.equal(voiceBookingFlow.wantsHuman(human), true, `expected "${human}" to be recognized as a human-handoff request`);
  }
});

test('LANGUAGE SWITCHING MID-FLOW: a caller can answer one flow question in Roman Urdu and the next in English — the deterministic parsers do not require a single language for the whole call', async () => {
  const conv = { slots: freshSlots() };
  const deps = {
    check_availability: async () => ({ slots: [{ time: '10:00 AM', minutes: 600 }] }),
  };

  await voiceBookingFlow.startFlow({ practice: PRACTICE, action: 'book', conv, callerPhone: '+15551234567', conversationId: 'call10', deps });
  let r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'cleaning chahiye', callerPhone: '+15551234567', conversationId: 'call10', deps });
  assert.equal(conv.slots.serviceId, 'cleaning');

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: 'kal', callerPhone: '+15551234567', conversationId: 'call10', deps });
  assert.ok(conv.slots.voiceResolvedDate, 'a Roman Urdu date word must resolve the date');

  r = await voiceBookingFlow.continueFlow({ practice: PRACTICE, conv, utteranceText: '10am', callerPhone: '+15551234567', conversationId: 'call10', deps });
  assert.match(r.reply, /name/i, 'switching back to English mid-flow must still be understood');
});
