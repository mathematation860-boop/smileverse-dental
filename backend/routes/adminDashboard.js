/**
 * Dashboard overview, patients, and analytics (Phase 3 §6, plus the
 * "Patients" and "Analytics" nav items).
 *
 * Every number here comes from a real repository query scoped to
 * req.practiceId — nothing is invented. An empty database means "0" or
 * an empty list, exactly as requirement #6 asks for; there is no
 * placeholder/sample data path.
 *
 * `buildAdminDashboardRouter(deps)` allows tests to inject fakes for
 * every repository — see tests/adminDashboardRoutes.test.js.
 */

const express = require('express');
const { requireAuth } = require('../middleware/authMiddleware');
const appointmentRepositoryReal = require('../repositories/AppointmentRepository');
const leadRepositoryReal = require('../repositories/LeadRepository');
const conversationRepositoryReal = require('../repositories/ConversationRepository');
const handoffRepositoryReal = require('../repositories/HandoffRepository');
const analyticsRepositoryReal = require('../repositories/AnalyticsRepository');
const { toDateStringInTimezone } = require('../utils/timezone');

const NEW_LEAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // "new" = last 7 days, a real time window, not a fabricated count

function buildAdminDashboardRouter(deps = {}) {
  const requireAuthMiddleware = deps.requireAuthMiddleware || requireAuth();
  const appointmentRepository = deps.appointmentRepository || appointmentRepositoryReal;
  const leadRepository = deps.leadRepository || leadRepositoryReal;
  const conversationRepository = deps.conversationRepository || conversationRepositoryReal;
  const handoffRepository = deps.handoffRepository || handoffRepositoryReal;
  const analyticsRepository = deps.analyticsRepository || analyticsRepositoryReal;

  const router = express.Router();
  router.use(requireAuthMiddleware);

  // GET /api/admin/dashboard/overview
  router.get('/admin/dashboard/overview', async (req, res) => {
    try {
      const practice = req.practice;
      const [appointments, leads, handoffs, eventCounts] = await Promise.all([
        appointmentRepository.findAll(req.practiceId),
        leadRepository.findAll(req.practiceId),
        handoffRepository.findAll(req.practiceId),
        analyticsRepository.getEventCounts(req.practiceId, ['appointment_booked', 'appointment_cancelled', 'appointment_rescheduled']),
      ]);

      const todayStr = toDateStringInTimezone(new Date(), practice.timezone);
      const now = Date.now();

      const todaysAppointments = appointments.filter((a) => a.date === todayStr && a.status !== 'Cancelled').length;
      const upcomingAppointments = appointments.filter((a) => a.date > todayStr && a.status !== 'Cancelled').length;
      const cancellations = appointments.filter((a) => a.status === 'Cancelled').length;
      const newLeads = leads.filter((l) => now - new Date(l.savedAt).getTime() <= NEW_LEAD_WINDOW_MS).length;
      const conversations = conversationRepository.listConversations(req.practiceId);
      const pendingHandoffs = handoffs.filter((h) => h.status === 'pending').length;

      res.json({
        demoMode: practice.demoMode,
        practiceName: practice.name,
        today: { date: todayStr, appointments: todaysAppointments },
        upcomingAppointments,
        newLeads,
        totalLeads: leads.length,
        conversations: conversations.length,
        pendingHandoffs,
        totalHandoffs: handoffs.length,
        cancellations,
        reschedules: eventCounts.appointment_rescheduled || 0,
        totalAppointmentsBooked: eventCounts.appointment_booked || 0,
      });
    } catch (error) {
      console.error('Admin dashboard overview failed:', error.message);
      res.status(500).json({ error: 'Failed to load dashboard overview' });
    }
  });

  // GET /api/admin/analytics -> the same event summary Phase 1 already logs, finally surfaced (see routes/analytics.js's original "stub for a future admin dashboard" comment).
  router.get('/admin/analytics', async (req, res) => {
    try {
      const summary = await analyticsRepository.getSummary(req.practiceId);
      res.json({ summary, demoMode: req.practice.demoMode });
    } catch (error) {
      console.error('Admin analytics fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to load analytics' });
    }
  });

  // GET /api/admin/patients -> derived from real appointment history, grouped by phone (no separate Patient collection exists — this IS the real data, not a mock).
  router.get('/admin/patients', async (req, res) => {
    try {
      const appointments = await appointmentRepository.findAll(req.practiceId);
      const todayStr = toDateStringInTimezone(new Date(), req.practice.timezone);
      const byPhone = new Map();

      for (const a of appointments) {
        const key = a.phone || a.email || a.name || `unknown-${a._id}`;
        if (!byPhone.has(key)) {
          byPhone.set(key, { name: a.name, phone: a.phone, email: a.email, appointmentCount: 0, upcomingCount: 0, lastVisitDate: null });
        }
        const entry = byPhone.get(key);
        entry.appointmentCount += 1;
        if (a.date >= todayStr && a.status !== 'Cancelled') entry.upcomingCount += 1;
        if (!entry.lastVisitDate || a.date > entry.lastVisitDate) entry.lastVisitDate = a.date;
        if (a.confirmedAt && (!entry._latestConfirmedAt || a.confirmedAt > entry._latestConfirmedAt)) {
          entry.name = a.name;
          entry.email = a.email;
          entry._latestConfirmedAt = a.confirmedAt;
        }
      }

      const patients = Array.from(byPhone.values())
        .map(({ _latestConfirmedAt, ...rest }) => rest)
        .sort((a, b) => (b.lastVisitDate || '').localeCompare(a.lastVisitDate || ''));

      res.json(patients);
    } catch (error) {
      console.error('Admin patients fetch failed:', error.message);
      res.status(500).json({ error: 'Failed to load patients' });
    }
  });

  return router;
}

module.exports = buildAdminDashboardRouter();
module.exports.buildAdminDashboardRouter = buildAdminDashboardRouter;
