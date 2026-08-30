# SmileVerse Dental — AI Receptionist

An AI-powered front-desk assistant for a dental practice: it answers
questions, checks insurance, walks a patient through booking, rescheduling,
or cancelling an appointment, triages dental emergencies, and hands off to
a human when it should. This repository is a **demo/prototype product**
built to be architecturally ready for a real, multi-practice SaaS —
not a finished one. Every integration that would normally need real
credentials (a calendar/PMS, email, SMS, a production database) is either
fully mocked or stubbed behind an interface that a real implementation can
drop into later without touching the rest of the code.

This README is the authoritative setup/architecture doc for the current
state of the project. (Two older files exist under `backend/QUICK_START.md`
and `backend/SETUP_GUIDE.md` from an earlier prototype iteration that used
a different AI provider and no database — they're left in place but are
stale; follow this file instead.)

---

## 1. What this actually is right now (read this first)

- **Demo mode is real and explicit.** Every practice config has `demoMode:
  true`, the frontend shows a small "DEMO" badge, and `GET
  /api/practice-config` reports it. Nothing pretends to be a live
  integration it isn't.
- **One practice exists today** (`smileverse-dental`), but the entire
  backend is multi-tenant: every database row and every request carries a
  `practiceId`, and adding a second practice is "add a new config file,"
  not "restructure the app."
- **Bookings are real; availability is mocked in demo mode, real once
  connected.** A booking made through this app is always a real MongoDB
  document. "Availability" itself comes from one of two places depending
  on `demoMode`: a deterministic mock scheduler (every practice, by
  default — including this demo practice), or, once a practice is
  switched to `demoMode: false` with `integrations.calendarProvider:
  'google'` AND has completed the OAuth connect flow, a real Google
  Calendar — real busy events, real business hours, real service
  duration, real double-booking prevention (see §10 and
  `backend/services/providers/GoogleCalendarAppointmentProvider.js`).
- **The AI never invents facts.** Prices, hours, services, insurance,
  and FAQ answers all come from one config object per practice
  (`backend/config/practices/*.js`) and are the same data the AI's system
  prompt is built from — the AI can't tell a patient something that isn't
  in that file.
- **Emergency triage does not depend on the AI.** Life-threatening keyword
  detection runs in plain deterministic code (`backend/services/emergencyService.js`)
  *before* any AI call, so a life-threatening message always gets the
  "call 911 / go to the ER" response even if the AI API is down, rate
  limited, or misclassifies the message.

---

## 2. Architecture

```
Frontend (React)                Backend (Express)
─────────────────                ────────────────────────────────────────
AIReceptionist.jsx      ─HTTP─▶  practiceContext middleware
 ├─ ChatPanel                     (resolves req.practice from
 ├─ BookingFlow                    X-Practice-Id header)
 ├─ FaqPanel / InsurancePanel            │
 └─ TopBar (DEMO badge)                  ▼
                                  routes/*.js  (thin — validate input,
                                  call a tool, shape the response)
                                          │
                                          ▼
                                  tools/receptionistTools.js
                                  (the ONE place business logic lives:
                                   get_practice_info, get_services,
                                   create_appointment, request_human_
                                   handoff, etc. — named to match an
                                   AI-tool vocabulary)
                                   │        │         │
                    ┌──────────────┘        │         └───────────────┐
                    ▼                       ▼                         ▼
       services/ai/ (AIProvider   services/providers/       services/notifications/
       interface, Gemini impl)    (AppointmentProvider       (EmailProvider/SMSProvider
                                   interface, Demo impl,      interfaces, Mock impls)
                                   PMSProvider interface —
                                   unwired)
                                          │
                                          ▼
                                repositories/*.js (practiceId-scoped
                                Mongoose access) ──▶ MongoDB
```

Layers, and why they're split this way:

1. **Frontend** — unchanged UI/UX from the working MVP; only wired to send
   an `X-Practice-Id` header and to show the demo badge.
2. **API (routes)** — one file per resource, each route validates its
   input (`middleware/validate.js`) and calls a tool function. No route
   contains business logic itself.
3. **AI orchestration** (`services/ai/`) — turns a patient message into a
   structured `{ intent, entities, reply, suggestedActions }` object using
   Gemini's structured JSON output. See the honest limitation below.
4. **Business logic / tools** (`tools/receptionistTools.js`) — the single
   choke point every booking, cancellation, handoff, or lookup goes
   through, whether it was triggered by the deterministic UI (today) or
   will eventually be triggered by AI function-calling or a voice call
   (later) — one implementation, not three.
5. **Provider/adapter layer** (`services/providers/`, `services/notifications/`,
   `services/ai/`) — interfaces + mock/demo implementations. This is the
   seam where real integrations get added.
6. **Repositories** (`repositories/*.js`) — thin, `practiceId`-scoped
   Mongoose wrappers. This is the seam for a future migration off
   MongoDB.

Full entity-by-entity documentation (which are real MongoDB collections,
which are in-memory, which are config objects, and why) is in
[`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).

### Honest limitation: AI "tools" vs. real function-calling

The product spec's tool names (`get_practice_info`, `create_appointment`,
etc.) exist as real functions in `tools/receptionistTools.js`, and the AI's
`intent`/`entities` output is effectively a tool selection + arguments.
But the current Gemini integration uses **structured JSON output**
(`responseSchema`), not native function-calling — the model does not
itself invoke these functions and get real results back mid-conversation.
Today, the actual side-effecting actions (book/reschedule/cancel, request
handoff) are triggered by the deterministic booking-flow UI calling the
matching REST route, which calls the same tool function. Read-only facts
(hours, prices, FAQs, insurance) are baked into the AI's system prompt from
the same config the tools return, so the AI's answers and the app's data
can't drift apart — but the AI isn't yet "calling" anything live mid-chat.
Moving to native function-calling (most Gemini/Claude models support it) is
the natural next step and would let the chat AI itself check real
availability or book an appointment inline; because all of today's routes
already funnel through the same tools layer, that change is additive, not
a rewrite.

---

## 3. Multi-tenancy

Every request resolves a practice (`middleware/practiceContext.js`) from
an `X-Practice-Id` header, a `practiceId` query param, or a configured
default — and 404s immediately on an unrecognized ID. Every database
collection and every repository function is `practiceId`-scoped. There is
no code path that reads or writes data without a practice filter, so one
clinic's data can never leak into another's. Onboarding a second practice
today means adding one file under `backend/config/practices/` — see
`docs/DATA_MODEL.md` for the exact shape.

## 4. Timezone-aware scheduling

Practice config carries an explicit IANA `timezone` (e.g.
`America/New_York` for this demo practice — deliberately **not** the
server's own timezone, since a demo operated from Pakistan should still
schedule correctly for a US-based practice). All "what is today / what
time is it right now" logic goes through `backend/utils/timezone.js`
(`Intl.DateTimeFormat`-based, no new dependency). Weekday-of-a-date
(`Monday`, `Tuesday`, ...) is treated as a property of the calendar date
itself and is deliberately computed via `Date.UTC` on the date's own
Y/M/D — never timezone-shifted — while "is this slot in the past" and
"what is today's date" correctly go through the practice's timezone.

## 5. Security

Changes made this round, and why:

- **CORS is now configurable and restrictable** (`CORS_ORIGIN` env var,
  comma-separated origins). Defaults to `*` only so the demo keeps working
  out of the box — set this before handling real patient data.
- **Error messages no longer leak internals to the client.** `routes/chat.js`
  used to return `{ error, details: error.message }`; it now returns a
  generic safe message and logs the real error server-side only.
- **Input validation** (`middleware/validate.js`): required-field checks
  and max-length enforcement (name/phone/email/message/chat message) on
  every route that writes data, to stop obviously abusive input before it
  reaches the database or costs an AI API call.
- **Request body size is capped** (`express.json({ limit: '200kb' })`).
- **No secrets in the frontend.** `GEMINI_API_KEY` is read only in
  `backend/services/ai/GeminiAIProvider.js`, server-side; the frontend
  never sees it. `.env` files are git-ignored; only `.env.example` files
  (placeholder names, no real values) are committed.
- **Fast-fail on a down database** (`mongoose.set('bufferCommands',
  false)` + a 5s `serverSelectionTimeoutMS`) instead of Mongoose's default
  10-second query buffering — so a database outage degrades gracefully in
  under a second instead of making the UI look frozen for 10 seconds per
  request.
- **Analytics can never break a request it's attached to.** Every
  analytics write is wrapped in its own try/catch (see
  `repositories/AnalyticsRepository.js`) — this was a real bug caught
  during this round's own testing (see "Test results" below) where an
  unhandled analytics error was breaking the life-threatening emergency
  response when the database was unreachable.
- **Notifications never break their caller.** Email/SMS sends go through
  `notifySafely()`, which catches everything.

Not done, and worth doing before this handles real patient data:

- Rate limiting on `/api/chat` and the booking endpoints (currently none —
  someone could script requests to it).
- A real schema-validation library (Zod/Joi) instead of the hand-rolled
  `validate.js` — fine for today's small set of fields, but doesn't scale
  well to more complex request bodies.
- Authenticated/admin-only routes — there is no admin surface yet, but
  `GET /api/analytics-summary` and similar operational endpoints are
  currently open; they should require auth once an admin dashboard exists.
- A real secrets manager for production deployment rather than plain
  environment variables.

## 6. Privacy & healthcare readiness

**This project does not claim HIPAA compliance**, and `practice.compliance.hipaaCompliant`
is explicitly set to `false` in config, not left ambiguous. No real
patient data is used anywhere in this demo — all appointments, leads, and
handoff requests created while testing are synthetic. Real HIPAA
compliance for a product like this would additionally require, at
minimum: a signed Business Associate Agreement with every subprocessor
that touches patient data (MongoDB Atlas, the AI provider, any SMS/email
provider); encryption at rest and in transit (Atlas provides
transit/at-rest encryption, but this needs to be verified and configured,
not assumed); strict audit logging of every access to patient records with
retention policy; role-based access control for any admin/staff-facing
surface; a documented data retention and deletion policy; and a security
review of the AI provider's own data-handling terms (does it retain
prompts/responses, and for how long). None of that exists today — this
section exists so it isn't quietly forgotten.

## 7. Demo mode

`practice.demoMode` is `true` in the one practice config that exists. The
frontend shows a small, unobtrusive "DEMO" badge (`TopBar.jsx` /
`.sv-demo-badge` in `AIReceptionist.css`) rather than hiding the fact that
this is mock data. Turning demo mode off for a real practice means: (1)
setting `demoMode: false` in that practice's config, (2) pointing
`integrations.*` at real providers once they're actually implemented, and
(3) removing/adjusting the badge condition — the code already reads this
one flag everywhere it matters.

## 8. Local setup

Requirements: Node.js 18+, a MongoDB connection string (Atlas free tier
works), a Gemini API key.

```bash
# Backend
cd backend
cp .env.example .env    # fill in GEMINI_API_KEY and MONGODB_URI
npm install
npm start                # http://localhost:5000

# Frontend (separate terminal)
cd frontend
cp .env.example .env    # defaults are fine for local dev
npm install
npm start                # http://localhost:3000
```

Without a real `GEMINI_API_KEY`/`MONGODB_URI`, the app still runs: chat
falls back to a safe "I'm having trouble right now, please call our office"
reply, and availability falls back to mock-only slots (no real DB lookup).
This was verified during this round's testing (see below) — it is
intentional graceful degradation, not a bug.

### Environment variables

See `backend/.env.example` and `frontend/.env.example` for the full,
commented list (placeholders only — no real values are committed).
Currently required for full functionality:

| Variable | Where | Purpose |
|---|---|---|
| `PORT` | backend | Server port (default 5000) |
| `GEMINI_API_KEY` | backend | Google Gemini API key for the chat AI |
| `MONGODB_URI` | backend | MongoDB connection string |
| `CORS_ORIGIN` | backend | Comma-separated allowed frontend origin(s); `*` for local dev |
| `DEFAULT_PRACTICE_ID` | backend | Which practice serves requests with no `X-Practice-Id` header |
| `REACT_APP_API_URL` | frontend | URL of the deployed backend |
| `REACT_APP_PRACTICE_ID` | frontend | Which practice this build talks to (only matters once a second practice exists) |

Placeholders for future integrations (not required today, documented so
the shape is known in advance): Google Calendar / PMS credentials,
SendGrid/Twilio credentials, a non-MongoDB `DATABASE_URL`, and a
`SESSION_SECRET`/`APP_URL` pair for if/when the app needs its own admin
auth. None of these are read by any code today.

## 9. Testing

Lightweight automated tests exist for the parts of the system that are
pure functions and safety-critical (`backend/tests/`, using Node's
built-in test runner — no new dependency):

```bash
cd backend
npm test
```

- `emergencyService.test.js` — life-threatening vs. urgent vs. ordinary
  message classification, and urgency-combination logic.
- `insuranceService.test.js` — fuzzy provider matching, case/punctuation
  insensitivity, and honest "I don't have enough information" for unknown
  providers.
- `availabilityService.test.js` — timezone-independent weekday
  calculation, open/closed-day logic, slot generation staying within
  configured business hours, and real bookings actually excluding a slot.
- `receptionistTools.test.js` — the read-only tool functions
  (`get_practice_info`, `get_services`, `get_hours`, `get_location`,
  `get_insurance_information`) return exactly the configured data and
  don't leak internal config fields.

**What isn't covered by automated tests, and why:** the side-effecting
tools (`create_appointment`, `reschedule_appointment`,
`request_human_handoff`, etc.) need a real MongoDB connection, and this
sandbox has no way to run one (no local `mongod`, and `mongodb-memory-server`'s
binary download is blocked here — `403` from `fastdl.mongodb.org`). These
were instead exercised end-to-end with a full browser (Playwright,
headless Chromium) against a running instance of the app for both product
rounds: booking flow, rescheduling, cancellation, FAQ answers, insurance
lookup, the emergency banner and 911 message, and the human-handoff panel
all click-tested and passing. Full DB-backed integration testing (book →
appointment disappears from availability → reschedule → cancel) should be
run once against your real deployed MongoDB before going live — this was
not possible to fully automate in this environment.

## 10. What's still demo/mock vs. integration-ready

| Capability | Status today | Integration point |
|---|---|---|
| Calendar/availability | **Implemented** (Phase 2): real Google Calendar when a practice has `demoMode:false` + `integrations.calendarProvider:'google'` AND has connected a calendar; mock/deterministic otherwise (every practice by default) | `GoogleCalendarAppointmentProvider` implements `AppointmentProvider` — see §12 below and `backend/services/providers/GoogleCalendarAppointmentProvider.js` |
| Practice-management system (PMS) | Not implemented | `PMSProvider` interface exists (unwired) — documents the contract, nothing more |
| Email notifications | Mocked (logs only, `sent: false`) | `EmailProvider` interface — write a `SendGridEmailProvider` |
| SMS notifications | Mocked (logs only, `sent: false`) | `SMSProvider` interface — write a `TwilioSMSProvider` |
| AI chat | Real (Gemini), structured-output not function-calling | `AIProvider` interface — swap vendors or add native function-calling in `GeminiAIProvider` |
| Voice AI | Not implemented | `VoiceReceptionist` interface stub — must call the same `tools/receptionistTools.js` functions as chat, never duplicate booking logic |
| Conversation memory | Real, in-memory (cleared on restart) | Same three-function interface would move to Redis/a DB table |
| Bookings/leads/handoffs/analytics | Real MongoDB | Already production-shaped; see `docs/DATA_MODEL.md` |
| Multi-practice | Real, one practice configured | Add a new file under `config/practices/` |
| Calendar OAuth admin auth | Stopgap only: a shared `CALENDAR_ADMIN_SECRET`, not real admin accounts | See §12 — flagged as a production blocker |

## 11. Recommended next integration

With real Google Calendar now implemented (Phase 2), in order of
remaining leverage: (1) native AI function-calling, so the chat AI can
check real availability and book inline instead of only through the
deterministic UI flow — deliberately NOT done in Phase 2, see §12; (2) a
real admin-auth system, so calendar connect/disconnect isn't gated by a
single shared secret; (3) a real SMS provider (Twilio), since appointment
reminders are the highest-value notification for a dental practice.

## 12. Phase 2: real Google Calendar integration

Implemented behind the exact same `AppointmentProvider` interface the mock
provider already used, so no route, frontend component, or AI prompt had
to change shape — only `services/providers/index.js`'s factory switch did:

- **The switch is `demoMode`, not just `calendarProvider`.** As long as a
  practice's `demoMode` is `true` (the default — including this demo
  practice, which stays on the mock provider as instructed), the real
  Google Calendar code path is never reached, even if
  `integrations.calendarProvider` were set to `'google'`. Going live for a
  real practice means a deliberate code change (`demoMode:false` +
  `integrations.calendarProvider:'google'`) plus completing the one-time
  OAuth connect flow below — never a runtime toggle.
- **Connect flow** (admin/setup action, no UI — see the security note
  below): visit `GET /api/calendar/oauth/start?adminSecret=...` with the
  practice's `X-Practice-Id`/`?practiceId=` set; you're redirected to
  Google's consent screen; on success, `POST /api/calendar/oauth/callback`
  (handled automatically by Google's redirect) stores a refresh token in a
  new `CalendarConnection` MongoDB collection, scoped to that one
  practiceId. `GET /api/calendar/status` reports connection state
  (never tokens). `POST /api/calendar/disconnect` removes it.
- **Real behavior once connected:** availability reflects real Google
  Calendar busy events, respects the practice's real business hours and
  timezone (DST-aware — see `backend/utils/timezone.js`), and is aware of
  each service's real duration (a 90-minute root canal won't be offered a
  slot that would run past closing). Booking re-checks for a live conflict
  immediately before creating the event (closing the race-condition
  window) and only creates a local appointment record AFTER Google
  Calendar actually confirms the event — a failed Google API call leaves
  zero local record, so nothing downstream (the AI, the UI) can ever
  reference a booking that didn't really happen. Reschedule/cancel work
  the same way against the real event.
- **AI tool integration, honestly described:** this app has never given
  the AI model native function-calling (see §8's existing note) — Phase 2
  did not change that, on purpose, to avoid redesigning the already-audited
  safety architecture where only the deterministic REST/UI layer executes
  side effects. "Give the receptionist tools to check availability/book/
  reschedule/cancel" is satisfied at the `tools/receptionistTools.js`
  layer (a new `check_availability` tool was added there, alongside the
  existing `create_appointment`/`reschedule_appointment`/`cancel_appointment`),
  which is now genuinely real when a practice is connected. The system
  prompt (`config/promptBuilder.js`) explicitly forbids the AI from ever
  asserting a booking/reschedule/cancellation succeeded on its own.
- **Security consideration flagged as a production blocker:** this app
  has no admin login/session system. The OAuth start/disconnect endpoints
  are gated by a single shared `CALENDAR_ADMIN_SECRET` env var as a
  stopgap — enough to stop a random visitor from connecting an arbitrary
  Google account to a practice, but a real per-practice admin-auth system
  is the correct fix before onboarding real practices self-serve.

---

*For the full data model (every entity, which are real MongoDB
collections vs. in-memory vs. config, and every provider/adapter
interface), see [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md).*
