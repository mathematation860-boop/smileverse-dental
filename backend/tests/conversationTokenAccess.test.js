/**
 * Conversation access: only a token this server issued and signed opens a
 * conversation.
 *
 * The defect was reachable in the shipped code. The widget derived its
 * conversation id from `Date.now()`, and POST /api/chat loads that
 * conversation's stored history and slots — which hold the patient's name,
 * phone and email — into the model's prompt. Guessing a timestamp read one
 * patient's details back out through the assistant's own reply, and wrote
 * into their transcript at the same time. The practice id comes from a
 * client header, so the conversation reached could belong to any clinic.
 *
 * WHY THESE TESTS TARGET FORGERY, NOT FORMAT. An intermediate version of
 * this fix only required the client to send a UUID. Several tests below
 * exist specifically to fail against that weaker design: a well-formed
 * UUID, and a token with a plausible shape but no valid signature, must
 * both be refused. A format check cannot tell those from a real token,
 * because under a format check the client is still the one choosing.
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  issueConversationToken,
  verifyConversationToken,
  resolveConversationToken,
} = require('../services/conversations/conversationToken');
const conversationStore = require('../services/conversationStore');

beforeEach(() => conversationStore._reset());

test('a token the server issued verifies, and yields a stable conversation id', () => {
  const token = issueConversationToken();
  const id = verifyConversationToken(token);
  assert.ok(id, 'an issued token must verify');
  assert.equal(verifyConversationToken(token), id, 'the same token must always name the same conversation');
});

test('every issued token is distinct', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(issueConversationToken());
  assert.equal(seen.size, 2000);
});

test('the id format the widget used to generate is refused', () => {
  assert.equal(verifyConversationToken(`conv_${Date.now()}`), null);
  assert.equal(verifyConversationToken('conv_1789282120406'), null);
});

test('a whole day of timestamps is refused, so the range cannot be walked', () => {
  const midnight = Date.UTC(2026, 8, 13);
  for (let ms = midnight; ms < midnight + 86400000; ms += 997) {
    if (verifyConversationToken(`conv_${ms}`)) assert.fail(`enumerable id accepted: conv_${ms}`);
  }
});

test('A CLIENT-CHOSEN UUID IS REFUSED — format is not the same as issuance', () => {
  // This is the case a format-validation fix would wrongly accept. The
  // server must be able to tell a token it minted from one a caller made
  // up, and randomness alone does not give it that.
  assert.equal(verifyConversationToken(crypto.randomUUID()), null);
  assert.equal(verifyConversationToken(`web_${crypto.randomUUID()}`), null);
});

test('a token with the right shape but a forged signature is refused', () => {
  const token = issueConversationToken();
  const [version, id] = token.split('.');
  const forged = `${version}.${id}.${'a'.repeat(32)}`;
  assert.equal(verifyConversationToken(forged), null, 'the MAC is what makes the token unforgeable');
});

test('a valid token with one character changed anywhere is refused', () => {
  const token = issueConversationToken();
  for (const position of [4, 12, 20, 36, 44, token.length - 1]) {
    const char = token[position];
    if (char === '.') continue;
    const swapped = char === 'a' ? 'b' : 'a';
    const tampered = token.slice(0, position) + swapped + token.slice(position + 1);
    assert.equal(verifyConversationToken(tampered), null, `tampering at ${position} must be caught`);
  }
});

test('a token signed with a different secret is refused', () => {
  // What a second deployment, or an attacker guessing at the scheme, would
  // produce. The id is well-formed; only the key differs.
  const id = crypto.randomBytes(16).toString('hex');
  const mac = crypto.createHmac('sha256', 'not-the-server-secret').update(`wc1.${id}`).digest('hex').slice(0, 32);
  assert.equal(verifyConversationToken(`wc1.${id}.${mac}`), null);
});

test('junk, empty and oversized values are refused rather than stored', () => {
  for (const junk of [null, undefined, '', 'x', 'wc1..', 'wc1.short.short', {}, 42, `wc1.${'f'.repeat(4000)}.${'f'.repeat(32)}`]) {
    assert.equal(verifyConversationToken(junk), null, `${String(junk).slice(0, 20)} must be refused`);
  }
});

test('a forged token can never attach to an existing conversation', () => {
  // The victim's conversation, under the id the old scheme would have used.
  const victimId = 'conv_1789282120406';
  conversationStore.appendMessage('practice-a', victimId, 'user', 'My number is 555-0101');
  conversationStore.updateSlots('practice-a', victimId, { name: 'Test Patient One', phone: '+1-555-0101' });

  const { conversationId, issued } = resolveConversationToken(victimId);
  assert.equal(issued, true, 'a forged token must be replaced, not honoured');
  assert.notEqual(conversationId, victimId);

  const served = conversationStore.getConversation('practice-a', conversationId);
  assert.deepEqual(served.history, [], 'the attacker must get an empty conversation');
  assert.equal(served.slots.phone, null);

  const victim = conversationStore.getConversation('practice-a', victimId);
  assert.equal(victim.history.length, 1, "and the victim's conversation must be untouched");
  assert.equal(victim.slots.phone, '+1-555-0101');
});

test('a legitimate token is passed through, so a patient keeps their context', () => {
  const token = issueConversationToken();
  const first = resolveConversationToken(token);
  conversationStore.appendMessage('practice-a', first.conversationId, 'user', 'How much is a cleaning?');

  const second = resolveConversationToken(token);
  assert.equal(second.issued, false);
  assert.equal(second.conversationId, first.conversationId);
  assert.equal(conversationStore.getConversation('practice-a', second.conversationId).history.length, 1);
});

test('CROSS-CLINIC: one token in two practices is two separate conversations', () => {
  const { conversationId } = resolveConversationToken(null);
  conversationStore.appendMessage('practice-a', conversationId, 'user', 'Clinic A private message');

  const atB = conversationStore.getConversation('practice-b', conversationId);
  assert.deepEqual(atB.history, [], 'a practice id from a header must not reach another clinic');
  assert.equal(conversationStore.getConversation('practice-a', conversationId).history.length, 1);
});

test('the store cannot be grown without bound', () => {
  // Signed tokens stop an attacker minting entries, but ordinary traffic
  // still needs a ceiling: before this, nothing ever removed an entry.
  const over = conversationStore.MAX_CONVERSATIONS + 500;
  for (let i = 0; i < over; i += 1) {
    conversationStore.getConversation('practice-a', resolveConversationToken(null).conversationId);
  }
  assert.ok(conversationStore.listConversations('practice-a').length <= conversationStore.MAX_CONVERSATIONS);
});

test('a conversation older than the TTL is swept', () => {
  const { conversationId: stale } = resolveConversationToken(null);
  const conv = conversationStore.getConversation('practice-a', stale);
  conv.createdAt = new Date(Date.now() - conversationStore.CONVERSATION_TTL_MS - 60000).toISOString();

  conversationStore.getConversation('practice-a', resolveConversationToken(null).conversationId);

  const ids = conversationStore.listConversations('practice-a').map((c) => c.conversationId);
  assert.ok(!ids.includes(stale));
});
