/**
 * Admin human-handoff queue (Phase 3 §9).
 *
 * `buildAdminHandoffsRouter(deps)` allows tests to inject a fake
 * repository — see tests/adminHandoffsRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const handoffRepositoryReal = require('../repositories/HandoffRepository');

function buildAdminHandoffsRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const handoffRepository = deps.handoffRepository || handoffRepositoryReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/handoffs -> every handoff request for THIS practice only.
  router.get('/admin/handoffs', async (req, res) => {
    try {
      const handoffs = await handoffRepository.findAll(req.practiceId);
      res.json(
        handoffs.map((h) => ({
          id: h._id,
          conversationId: h.conversationId,
          reason: h.reason,
          type: h.type,
          urgency: h.urgency,
          name: h.name,
          phone: h.phone,
          message: h.message,
          status: h.status,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        }))
      );
    } catch (error) {
      console.error('Admin handoffs fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to fetch handoffs' });
    }
  });

  // PATCH /api/admin/handoffs/:id -> { status: 'pending' | 'assigned' | 'resolved' }
  router.patch('/admin/handoffs/:id', async (req, res) => {
    try {
      const { status } = req.body || {};
      if (!['pending', 'assigned', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'status must be one of: pending, assigned, resolved' });
      }
      const handoff = await handoffRepository.updateStatus(req.practiceId, req.params.id, status);
      if (!handoff) return res.status(404).json({ error: 'Handoff request not found' });
      res.json({ success: true, data: { id: handoff._id, status: handoff.status } });
    } catch (error) {
      console.error('Admin handoff status update failed:', error.message);
      res.status(500).json({ error: 'Failed to update handoff status' });
    }
  });

  return router;
}

module.exports = buildAdminHandoffsRouter();
module.exports.buildAdminHandoffsRouter = buildAdminHandoffsRouter;
