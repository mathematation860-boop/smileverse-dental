/**
 * Regression test for a real bug found during manual deployment testing:
 * routes/voice.js's router calls `router.use(voicePracticeContext)`
 * unconditionally, which Express runs for EVERY request that reaches
 * that router — not just requests matching its own `/incoming`/`/gather`/
 * `/status` routes. The router was originally mounted at the same bare
 * '/api' prefix every other router uses (`app.use('/api', voiceRouter)`),
 * which meant voicePracticeContext.js intercepted and rejected EVERY
 * single /api/* request in the app — including /api/admin/login — before
 * it ever reached its real handler, because Express delegates a request
 * to each `app.use('/api', ...)` registration in order until one sends a
 * response, and this router's unconditional `.use()` middleware always
 * "handled" it first.
 *
 * The fix: mount this router at the specific '/api/voice' prefix (see
 * server.js) so only requests actually under /api/voice/* ever reach it.
 * This test proves that fix holds by building a miniature version of
 * server.js's real routing shape — two routers, mounted the same way
 * server.js mounts them — and confirming a request to an unrelated path
 * (standing in for /api/admin/login) is handled by the OTHER router,
 * never intercepted by voice's practice-context middleware.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { buildVoiceRouter } = require('../routes/voice');

function fakeVoicePracticeContext(req, res, next) {
  // Stands in for the real middleware/voicePracticeContext.js: since this
  // request has no body.To it doesn't recognize, a BROKEN mount would let
  // this run and reject the request right here — a correct mount means
  // this function is never even called for a request to another route.
  res.status(200).type('text/xml').send('<Response><Say>Not in service</Say><Hangup/></Response>');
}

function startTestApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Mirrors server.js: voice mounted at its OWN sub-path...
  app.use('/api/voice', buildVoiceRouter({ voicePracticeContext: fakeVoicePracticeContext }));

  // ...and an unrelated admin-style router mounted at the shared '/api'
  // prefix, exactly like routes/adminAuth.js is in the real app.
  const adminRouter = express.Router();
  adminRouter.post('/admin/login', (req, res) => res.json({ success: true, admin: { email: req.body.email } }));
  app.use('/api', adminRouter);

  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('REGRESSION: mounting the voice router at /api/voice never intercepts unrelated /api/* routes like /api/admin/login', async () => {
  const server = await startTestApp();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'x' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.admin.email, 'admin@example.com', 'the admin route\'s own handler must have responded, not the voice middleware');
  } finally {
    server.close();
  }
});

test('a genuine /api/voice/* request DOES reach the voice router\'s own middleware', async () => {
  const server = await startTestApp();
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/voice/incoming`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'CallSid=CA1&From=%2B1555&To=%2B1555',
    });
    const text = await res.text();
    assert.match(text, /Not in service/, 'a real voice webhook path must still go through voicePracticeContext');
  } finally {
    server.close();
  }
});
