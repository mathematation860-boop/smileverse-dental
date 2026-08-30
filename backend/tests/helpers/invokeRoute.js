/**
 * Minimal Express-route test harness — deliberately NOT supertest/an HTTP
 * server. This project's existing tests never spin up a live server or a
 * real database (none is reachable in CI/sandbox — see the Phase 2/3
 * reports); every test instead injects fakes directly into pure/DI-built
 * modules. This helper extends that same philosophy one layer up: it
 * walks an Express Router's FULL middleware stack (both `router.use(...)`
 * layers — e.g. `requireAuth()` — and the matching `router.get/put/...`
 * route layer) for one method+path, running it against a plain fake
 * req/res exactly the way Express itself would dispatch it, so admin
 * route handlers (built via routes/admin*.js's `buildXRouter(deps)`
 * factories) can be exercised for real without an HTTP listener or a
 * database.
 */

function mockRes(onSettled) {
  const res = {
    statusCode: 200,
    body: undefined,
    cookies: {},
    clearedCookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      onSettled();
      return this;
    },
    cookie(name, value, opts) {
      this.cookies[name] = { value, opts };
      return this;
    },
    clearCookie(name, opts) {
      this.clearedCookies.push({ name, opts });
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
      onSettled();
      return this;
    },
    // Phase 4 (voice/TwiML routes): res.type(...).send(...) and
    // res.sendStatus(...) — additive, same settle-on-response-sent
    // contract as json()/redirect() above.
    type(contentType) {
      this.contentType = contentType;
      return this;
    },
    send(payload) {
      this.body = payload;
      onSettled();
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.body = undefined;
      onSettled();
      return this;
    },
  };
  return res;
}

/**
 * Runs `router`'s full stack against `req` as if a real `method path`
 * request arrived: every `router.use(...)` middleware layer runs first
 * (in registration order), then the ONE route layer whose registered
 * path/method matches. Resolves { req, res } once a response is sent
 * (res.json/redirect short-circuits any later layers, matching real
 * Express behavior) or the stack is exhausted with no match.
 */
async function invokeRoute(router, method, path, req) {
  return new Promise((resolve, reject) => {
    let layerIndex = 0;
    let settled = false;
    const res = mockRes(() => {
      if (!settled) {
        settled = true;
        resolve({ req, res });
      }
    });

    function runHandlerStack(handlers, onDone) {
      let i = 0;
      function nextHandler(err) {
        if (settled) return;
        if (err) return reject(err);
        const handle = handlers[i++];
        if (!handle) return onDone();
        try {
          Promise.resolve(handle(req, res, nextHandler)).catch((e) => {
            if (!settled) reject(e);
          });
        } catch (syncErr) {
          if (!settled) reject(syncErr);
        }
      }
      nextHandler();
    }

    function nextLayer(err) {
      if (settled) return;
      if (err) return reject(err);
      const layer = router.stack[layerIndex++];
      if (!layer) {
        settled = true;
        return resolve({ req, res }); // stack exhausted, no matching route — final state as-is
      }
      if (layer.route) {
        const pathMatches = layer.route.path === path;
        const methodMatches = !!layer.route.methods[method.toLowerCase()];
        if (pathMatches && methodMatches) {
          const handlers = layer.route.stack.map((l) => l.handle);
          return runHandlerStack(handlers, () => nextLayer());
        }
        return nextLayer(); // this route doesn't match — Express would skip it too
      }
      // A plain `router.use(middleware)` layer (e.g. requireAuth()) — always runs.
      try {
        Promise.resolve(layer.handle(req, res, nextLayer)).catch((e) => {
          if (!settled) reject(e);
        });
      } catch (syncErr) {
        if (!settled) reject(syncErr);
      }
    }

    nextLayer();
  });
}

module.exports = { invokeRoute, mockRes };
