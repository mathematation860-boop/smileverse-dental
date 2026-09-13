/**
 * Server-issued, signed conversation tokens.
 *
 * THE PROBLEM. The web widget generated its own conversation id as
 * `conv_${Date.now()}` (frontend/src/AIReceptionist.jsx:19) — a
 * millisecond timestamp, and the only thing identifying an anonymous
 * chat. POST /api/chat loads that conversation's stored history and slots
 * — which hold the patient's name, phone and email — into the model's
 * prompt before it answers, so guessing an id made the assistant read
 * another patient's details back in its own reply, while the same request
 * wrote into their transcript. Since practiceId comes from a client
 * header, the conversation guessed at could belong to any clinic.
 *
 * WHY A FORMAT CHECK IS NOT ENOUGH. An earlier version of this fix simply
 * required the client to send a UUID. That raises the cost of guessing,
 * but it is not an access control: the client still chooses the value, so
 * the server has no way to tell a token it issued from one an attacker
 * invented. Two things follow. First, "unguessable" then depends entirely
 * on the client actually using a good random source — a property the
 * server cannot check and an attacker has no reason to honour. Second,
 * and worse, `getConversation` creates on read, so anyone could still
 * mint unlimited store entries by inventing well-formed ids.
 *
 * WHAT THIS DOES INSTEAD. The server issues the token and signs it. A
 * token is `wc1.<id>.<mac>` where `id` is 128 bits from the CSPRNG and
 * `mac` is an HMAC-SHA256 of that id under a server secret. Verification
 * is a constant-time comparison, so a token the server did not issue is
 * rejected before the conversation store is touched at all — which closes
 * both the guessing route and the store-flooding route in one step.
 *
 * THE SECRET. `CONVERSATION_TOKEN_SECRET` if set; otherwise a random
 * secret generated per process. The fallback is deliberate rather than
 * lazy: the conversation store is itself in-memory and does not survive a
 * restart, so a per-process secret invalidates exactly the tokens whose
 * conversations are gone anyway. Set the env var when the store moves to
 * Redis or a database, or when more than one instance runs — otherwise
 * two instances will reject each other's tokens.
 */

const crypto = require('crypto');

const VERSION = 'wc1';
const ID_BYTES = 16; // 128 bits
const MAC_HEX_CHARS = 32; // 128 bits of the HMAC, plenty against forgery
const MAX_TOKEN_LENGTH = 128;

const secret =
  process.env.CONVERSATION_TOKEN_SECRET && process.env.CONVERSATION_TOKEN_SECRET.length >= 16
    ? process.env.CONVERSATION_TOKEN_SECRET
    : crypto.randomBytes(32).toString('hex');

const usingEphemeralSecret = !process.env.CONVERSATION_TOKEN_SECRET;

function macFor(id) {
  return crypto.createHmac('sha256', secret).update(`${VERSION}.${id}`).digest('hex').slice(0, MAC_HEX_CHARS);
}

/** A fresh signed token. The only way a valid token ever comes into existence. */
function issueConversationToken() {
  const id = crypto.randomBytes(ID_BYTES).toString('hex');
  return `${VERSION}.${id}.${macFor(id)}`;
}

/**
 * The conversation id inside a token, or null if the token was not issued
 * by this server. Null covers every failure — wrong shape, wrong version,
 * bad signature — so a caller cannot learn which part was wrong.
 */
function verifyConversationToken(token) {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [version, id, mac] = parts;
  if (version !== VERSION) return null;
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  if (!/^[0-9a-f]{32}$/.test(mac)) return null;

  const expected = Buffer.from(macFor(id), 'utf8');
  const supplied = Buffer.from(mac, 'utf8');
  if (expected.length !== supplied.length) return null;
  if (!crypto.timingSafeEqual(expected, supplied)) return null;

  return id;
}

/**
 * The token and conversation id a chat request should be served with.
 *
 * An unsigned, forged or missing token is REPLACED with a freshly issued
 * one rather than rejected. Rejecting would hand an error to a patient
 * whose browser still holds an old cached bundle, and would tell someone
 * probing tokens that they had found a real conversation shape. Replacing
 * costs a legitimate caller nothing but a new, empty conversation — which
 * is exactly what a forged token should get.
 *
 * Returns { token, conversationId, issued }.
 */
function resolveConversationToken(supplied) {
  const existing = verifyConversationToken(supplied);
  if (existing) return { token: supplied, conversationId: existing, issued: false };

  const token = issueConversationToken();
  return { token, conversationId: verifyConversationToken(token), issued: true };
}

module.exports = {
  issueConversationToken,
  verifyConversationToken,
  resolveConversationToken,
  usingEphemeralSecret,
  MAX_CONVERSATION_TOKEN_LENGTH: MAX_TOKEN_LENGTH,
};
