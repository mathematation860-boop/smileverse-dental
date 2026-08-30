# Data Model

This document describes the core entities in the SmileVerse Dental AI
receptionist codebase: which ones are real, persisted MongoDB collections
today, which ones are in-memory, and which ones are documented shapes that
don't need a database table yet but are written down so a real
implementation later matches what the rest of the code already expects.

No new database or schema migration was introduced to write this document —
it describes the models and config objects that already exist in code
(`backend/models/*.js`, `backend/config/practices/*.js`,
`backend/services/conversationStore.js`) after the multi-tenancy and
provider-abstraction refactor.

## How to read this

- **Persisted (MongoDB)** — a real Mongoose model, a real collection, survives a server restart.
- **In-memory** — real today, but stored in a JS `Map`/object in the running process; cleared on restart. Documented here because the *shape* is what matters for a future migration to Redis/Postgres, not the storage mechanism.
- **Config object** — not a database row at all; a plain JS object in `backend/config/`, one per practice. This is intentionally *not* a database table yet — see "Practice" below for why.

---

## Practice

**Config object**, one file per practice under `backend/config/practices/`
(today: `smileverse-dental.js`), looked up by `practiceId` via
`backend/config/practiceRepository.js`.

| Field | Type | Notes |
|---|---|---|
| `practiceId` | string | Stable slug, used as the tenant key everywhere else in the system (see "Multi-tenancy" below). |
| `demoMode` | boolean | Drives the UI's "Demo" badge and is returned by `GET /api/practice-config`. |
| `name`, `tagline`, `phone`, `email`, `address`, `website` | string | Public-facing practice info. |
| `timezone` | IANA string (e.g. `America/New_York`) | **All** scheduling math for this practice happens in this timezone — never the server's own local time. See `backend/utils/timezone.js`. |
| `hours` | object | `{ display, displayUr, openDays: number[] (0=Sun..6=Sat), openTime: 'HH:MM', closeTime: 'HH:MM', slotMinutes }` |
| `services` | `Service[]` | See below. |
| `cancellationPolicy` | object | `{ summary, summaryUr }` |
| `emergencyPolicy` | object | `{ summary, emergencyServiceId }` — human-readable copy only; the actual triage decision is code, not config (see `emergencyService.js`). |
| `faqs` | `FAQ[]` | Currently shared across practices via `config/faqs.js`; per-practice override is a one-line change (point this field at a different file). |
| `insurance` | object | `{ acceptedProviders: string[], notes, notesUr }`, currently shared via `config/insurance.js`. |
| `integrations` | object | `{ calendarProvider, pmsProvider, emailProvider, smsProvider, aiProvider }` — which adapter serves this practice for each capability. Every value is `'demo'`/`'mock'`/`'none'` today. This is the single place a practice gets pointed at a real integration later. |
| `compliance` | object | `{ hipaaCompliant: false }` — explicit, not aspirational. See README "Privacy & healthcare readiness". |

**Why a config object and not a database table:** the spec asked for the
data model to be *documented*, not for a new admin-managed database to be
built this round. A `Practice` collection with CRUD and an admin UI is a
natural next step once there is a second real practice to onboard, and the
shape above is exactly what that collection's schema would be — moving it
into MongoDB later means writing `PracticeRepository.getPractice(id)` to
query a collection instead of reading a `require(...)`, with the exact same
return shape, so nothing that calls `req.practice` today has to change.

### Provider (staff)

Not modeled as a separate entity yet — there is a single practice-wide
calendar today, no per-dentist assignment. `Provider { providerId, name,
services[] }` is the natural extension once a practice has more than one
dentist and appointments need to be assigned to a specific one; the
`AppointmentProvider` interface (see below) is where that would plug in.

### Service

Embedded array on `Practice.services`, not its own collection (nine fixed
services per practice today).

| Field | Type |
|---|---|
| `id` | string, stable slug (e.g. `cleaning`) — referenced by `Appointment.serviceId` and the AI's structured-output schema |
| `name`, `description` | string |
| `price` | number or `null` (`null` = "priced after evaluation", e.g. Emergency/Other) |
| `duration` | number, minutes |
| `eligiblePatientTypes` | `('new'\|'existing')[]` |

---

## Appointment

**Persisted (MongoDB)** — `backend/models/Appointment.js`, accessed only
through `backend/repositories/AppointmentRepository.js`.

| Field | Type | Notes |
|---|---|---|
| `practiceId` | string, required, indexed | Tenant key — every query is scoped by this. |
| `name`, `phone`, `email` | string | Patient-provided contact info for this booking. |
| `service`, `serviceId` | string | Human label + the `Service.id` slug. |
| `patientType` | enum `new`\|`existing` | |
| `reason` | string | Free-text reason, optional. |
| `date` | string `YYYY-MM-DD` | Calendar date, timezone-independent by construction (see `weekdayOfDateString` in `availabilityService.js`). |
| `time` | string, e.g. `'10:30 AM'` | Slot label, in the practice's local time. |
| `status` | enum `Confirmed`\|`Rescheduled`\|`Cancelled` | |
| `isEmergency` | boolean | Set when booked from the emergency flow. |
| `confirmedAt`, `updatedAt` | Date | |

Indexes: `{ practiceId: 1, date: 1 }` (availability lookups),
`{ practiceId: 1, phone: 1 }` (a patient looking up "my appointments").

No cross-practice leakage: every repository method takes `practiceId` as
its first argument and every query includes it — there is no code path that
reads an `Appointment` without a practice filter.

## Lead

**Persisted (MongoDB)** — `backend/models/Lead.js`, via
`backend/repositories/LeadRepository.js`. A lightweight "someone left their
contact info" record, distinct from a `HandoffRequest` (which always
implies a human needs to follow up) — a lead is informational and optional
for a future CRM/marketing integration.

| Field | Type |
|---|---|
| `practiceId` | string, required, indexed |
| `name`, `email`, `phone`, `message` | string |
| `savedAt` | Date |

## HumanHandoff (`HandoffRequest`)

**Persisted (MongoDB)** — `backend/models/HandoffRequest.js`, via
`backend/repositories/HandoffRepository.js` and created by the
`request_human_handoff` / `create_callback_request` tools.

| Field | Type | Notes |
|---|---|---|
| `practiceId` | string, required, indexed | |
| `conversationId` | string | Links back to the conversation that triggered it. |
| `reason` | string | Free text, e.g. `clinical_question`, `complaint`, `insurance`, `billing`, `requested_staff`, `uncertain`, `urgent`. |
| `type` | enum `call_office`\|`request_callback`\|`send_message` | The requested action. |
| `name`, `phone`, `message` | string | Patient info, if given — never required to submit a handoff. |
| `status` | enum `open`\|`resolved` | The spec's `pending`/`assigned`/`resolved` maps to this today as a simpler two-state field (`open` covers both pending and assigned, since there's no staff-assignment feature yet); adding an `assigned` state and an `assignedTo` field is additive, not a breaking change. |
| `createdAt` | Date | |

## AnalyticsEvent

**Persisted (MongoDB)** — `backend/models/AnalyticsEvent.js`, via
`backend/repositories/AnalyticsRepository.js`. Deliberately schema-loose
(a `name` enum + a JSON `payload`) so new event types don't need a
migration.

| Field | Type |
|---|---|
| `practiceId` | string, required, indexed |
| `name` | enum: `conversation_started`, `appointment_requested`, `appointment_booked`, `appointment_cancelled`, `appointment_rescheduled`, `emergency_request`, `human_handoff_requested`, `unanswered_question` |
| `conversationId` | string |
| `payload` | `Mixed` (arbitrary JSON) |
| `createdAt` | Date |

**Important behavior:** `AnalyticsRepository.logEvent()` and `getSummary()`
both catch and log their own errors rather than throwing (see the comment
in that file). Analytics must never be able to break the request it's
attached to — a booking, a chat reply, or the life-threatening emergency
message all must succeed even if the database is down or analytics writes
fail for any reason.

## Conversation / ConversationMessage

**In-memory** — `backend/services/conversationStore.js`, a `Map` keyed by
`` `${practiceId}::${conversationId}` ``, wrapped by
`backend/repositories/ConversationRepository.js`.

```
Conversation {
  practiceId: string
  conversationId: string
  history: ConversationMessage[]   // capped at the most recent 40
  slots: {
    serviceId: string | null
    datePreference: string | null
    patientType: 'new' | 'existing' | null
    name: string | null
    phone: string | null
    email: string | null
    language: 'en' | 'ur'
  }
  createdAt: ISO date string
}

ConversationMessage {
  role: 'user' | 'assistant'
  content: string
}
```

`slots` is the "context memory" that lets the receptionist avoid re-asking
things the patient already said. It merges new values in without ever
overwriting a known value with `null`/empty — see `updateSlots()`.

**Why in-memory today, and what changes for production:** conversation
state is short-lived by nature (a single chat session) and clearing it on
restart is an acceptable tradeoff for a demo. Moving to Redis (for
multi-instance deployments) or a database table is a drop-in replacement
behind the same three functions (`getConversation` /`appendMessage`
/`updateSlots`) — nothing that calls `ConversationRepository` needs to
change.

## InsurancePlan

Not its own entity — `Practice.insurance` is `{ acceptedProviders:
string[], notes, notesUr }`, a flat list rather than a `InsurancePlan[]`
collection, because there is no per-plan detail (copay, coverage
percentage, etc.) in this product yet. `insuranceService.checkProvider()`
does fuzzy matching against this list and always returns either a matched
provider name or an honest "I don't have enough information" — it never
invents plan details that aren't in this list.

## FAQ

Embedded array on `Practice.faqs` (`backend/config/faqs.js`), grouped into
categories. Shape: `{ category, categoryUr, items: [{ question,
questionUr, answer, answerUr }] }`. Answered directly from this data by
both the REST route (`GET /api/faqs`) and the AI's system prompt (see
`config/promptBuilder.js`) — one source of truth either way.

---

## Provider/Adapter interfaces (not data, but part of the model)

These aren't persisted entities — they're the abstraction boundaries the
spec asked for, so a real integration later is a new class, not a rewrite.

- **`AppointmentProvider`** (`backend/services/providers/AppointmentProvider.js`) — `getAvailability`, `getAvailableDates`, `createAppointment`, `rescheduleAppointment`, `cancelAppointment`, `getAppointment`, `searchAppointments`, `getAllAppointments`. Today's only implementation, `DemoAppointmentProvider`, generates mock availability (`availabilityService.js`) but persists real bookings to the real `Appointment` collection — a booking made through this app really does reduce future availability for that practice.
- **`PMSProvider`** (`backend/services/providers/PMSProvider.js`) — interface only, not wired to anything. Documents what a real practice-management-system integration (Dentrix, OpenDental, etc.) would need to implement.
- **`EmailProvider` / `SMSProvider`** (`backend/services/notifications/`) — `MockEmailProvider`/`MockSMSProvider` log and return `{ sent: false, mocked: true }`; a real `SendGridEmailProvider`/`TwilioSMSProvider` would implement the same `.send()` shape. Calls are wrapped in `notifySafely()` so a notification failure never breaks the booking/reschedule/cancel it's attached to.
- **`AIProvider`** (`backend/services/ai/AIProvider.js`) — `understandAndReply({ practice, message, history, slots })`. `GeminiAIProvider` is the only implementation; swapping models/vendors means writing a new class with the same method signature, selected via `practice.integrations.aiProvider`.
- **`VoiceReceptionist`** (`backend/services/voice/VoiceReceptionist.js`) — interface-only stub (`handleUtterance(practice, callSessionId, transcribedText)`), not implemented. Its documented contract is to call into the **same** `backend/tools/receptionistTools.js` functions the chat flow uses, so voice never gets its own parallel booking logic.

## Multi-tenancy summary

Every persisted collection carries `practiceId` and is indexed on it.
Every repository function takes `practiceId` as an explicit argument —
there is no "current practice" global. `backend/middleware/practiceContext.js`
resolves `req.practiceId`/`req.practice` once per request (from the
`X-Practice-Id` header, a `practiceId` query param, or a configured
default) and 404s on an unknown practice before any route logic runs, so a
typo in a practice ID can't accidentally fall through to someone else's
data.
