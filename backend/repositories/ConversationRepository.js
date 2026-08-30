/**
 * Public-facing conversation store interface. Thin wrapper around
 * services/conversationStore.js (in-memory today) so routes depend on a
 * "repository" the same way they do for every other entity — swapping
 * the backing store to Redis later means rewriting conversationStore.js
 * only, not this file's callers.
 */

const store = require('../services/conversationStore');

module.exports = {
  getConversation: store.getConversation,
  appendMessage: store.appendMessage,
  updateSlots: store.updateSlots,
  listConversations: store.listConversations,
};
