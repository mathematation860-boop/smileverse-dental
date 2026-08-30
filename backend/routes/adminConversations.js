/**
 * Admin conversations view (Phase 3 §8).
 *
 * Privacy-conscious by design: the list view returns only what's needed
 * to triage at a glance (timing, whether contact info was captured,
 * urgency, real logged appointment/handoff outcomes) — the full message
 * transcript is only returned from the single-conversation detail route,
 * which an admin has to deliberately open.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const conversationRepository = require('../repositories/ConversationRepository');
const handoffRepository = require('../repositories/HandoffRepository');
const analyticsRepository = require('../repositories/AnalyticsRepository');

const router = express.Router();
router.use(requireAuth());

function summarize(conv, handoffConversationIds, appointmentEventByConversation) {
  return {
    conversationId: conv.conversationId,
    createdAt: conv.createdAt,
    messageCount: conv.history.length,
    hasContactInfo: Boolean(conv.slots.name && conv.slots.phone),
    language: conv.slots.language || 'en',
    urgency: conv.slots.urgency || 'none',
    handoffRequested: handoffConversationIds.has(conv.conversationId),
    // Real, logged outcome (appointment_booked/rescheduled/cancelled) if
    // one exists for this conversation — never fabricated; absent means
    // no appointment event was ever logged for this conversation.
    appointmentEvent: appointmentEventByConversation[conv.conversationId] || null,
  };
}

// GET /api/admin/conversations -> list, newest first, for THIS practice only.
router.get('/admin/conversations', async (req, res) => {
  try {
    const conversations = conversationRepository.listConversations(req.practiceId);
    const handoffs = await handoffRepository.findAll(req.practiceId);
    const handoffConversationIds = new Set(handoffs.map((h) => h.conversationId).filter(Boolean));
    const appointmentEventByConversation = await analyticsRepository.getLatestAppointmentEventsByConversation(
      req.practiceId,
      conversations.map((c) => c.conversationId)
    );
    res.json(conversations.map((c) => summarize(c, handoffConversationIds, appointmentEventByConversation)));
  } catch (error) {
    console.error('Admin conversations fetch failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/admin/conversations/:id -> one conversation's full transcript + derived status.
router.get('/admin/conversations/:id', async (req, res) => {
  try {
    // getConversation() creates-if-missing (see conversationStore.js) — that's
    // fine for the public chat route, but an admin opening an id that was
    // never actually used for this practice should get a 404, not a freshly
    // minted empty conversation.
    const all = conversationRepository.listConversations(req.practiceId);
    const conv = all.find((c) => c.conversationId === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const handoffs = await handoffRepository.findAll(req.practiceId);
    const relatedHandoffs = handoffs.filter((h) => h.conversationId === conv.conversationId);
    const appointmentEventByConversation = await analyticsRepository.getLatestAppointmentEventsByConversation(req.practiceId, [conv.conversationId]);

    res.json({
      conversationId: conv.conversationId,
      createdAt: conv.createdAt,
      slots: conv.slots,
      history: conv.history, // { role, content }[] — no internal fields beyond what the chat itself already shows
      appointmentEvent: appointmentEventByConversation[conv.conversationId] || null,
      handoffs: relatedHandoffs.map((h) => ({ id: h._id, status: h.status, reason: h.reason, type: h.type, urgency: h.urgency, createdAt: h.createdAt })),
    });
  } catch (error) {
    console.error('Admin conversation detail fetch failed:', error.message);
    res.status(500).json({ error: 'Failed to fetch conversation' });
  }
});

module.exports = router;
