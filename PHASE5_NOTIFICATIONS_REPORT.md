# Phase 5 — SMS + Email Communication & Notification System

Status: implemented, tested, and wired in. **No real SMS or email has been sent** — every practice in this codebase still runs in Demo Mode, so every notification is simulated by mock providers. Nothing here should be read as "SMS/email is live" until a practice is deliberately switched to `demoMode:false` with real Twilio/SendGrid credentials, and that switch has never been exercised end-to-end against real accounts in this session.

Test results: **355/355 backend tests passing**, **5/5 frontend tests passing**, production frontend build clean. Zero regressions from Phases 1–4.

---

## 1. Files changed

**New backend files (20):**
`services/notifications/EmailProvider.js`, `SMSProvider.js`, `MockEmailProvider.js`, `MockSMSProvider.js`, `TwilioSMSProvider.js`, `SendGridEmailProvider.js`, `index.js`, `validation.js`, `templates.js`, `retry.js`, `notificationService.js`, `reminderScheduler.js`; `models/NotificationLog.js`; `repositories/NotificationLogRepository.js`; `services/sms/smsReceptionistEngine.js`; `middleware/smsPracticeContext.js`; `routes/smsWebhook.js`; `routes/adminNotifications.js`.

**New frontend files (2):** `admin/pages/NotificationsPage.jsx`, `admin/pages/NotificationHistoryPage.jsx`.

**New test files (12):** `notificationProviders.test.js`, `notificationProviderSelection.test.js`, `notificationTemplates.test.js`, `notificationRetry.test.js`, `notificationValidation.test.js`, `notificationService.test.js`, `reminderScheduler.test.js`, `receptionistToolsNotifications.test.js`, `smsPracticeContext.test.js`, `smsWebhook.test.js`, `smsReceptionistEngine.test.js`, `adminNotificationsRoutes.test.js`.

**Modified backend files (13):** `models/Appointment.js` (smsOptIn/emailOptIn/language fields), `config/practices/smileverse-dental.js` (added `notifications` block), `services/practice/practiceMerge.js` (notification override rules), `models/PracticeSettings.js`, `services/practice/settingsValidation.js` (new validator), `tools/receptionistTools.js` (wired notifications into booking/reschedule/cancel/handoff), `routes/appointments.js` (opt-in/language passthrough), `services/receptionistEngine.js` + `services/voice/voiceReceptionistEngine.js` (emergency alert hook), `services/voice/twimlBuilder.js` (Messaging TwiML), `config/practiceRepository.js` (SMS number resolution), `server.js` (mounted routes + scheduler start), `.env.example`.

**Modified frontend files (3):** `admin/services/adminApi.js`, `admin/components/AdminLayout.jsx`, `admin/AdminApp.jsx`.

**Modified test files (4):** `receptionistEngine.test.js`, `voiceReceptionistEngine.test.js`, `settingsValidation.test.js`, `practiceMerge.test.js` (all updated only to inject a fake `notificationService` so the new emergency-alert hook never hits a real database during those pre-existing tests).

## 2. Notification architecture

Exactly the diagram in the spec: **Appointment/Event → `notificationService.js` → Email/SMS provider → Patient**. `services/notifications/notificationService.js` is the single place notification business logic lives — every call site (`tools/receptionistTools.js`, `services/receptionistEngine.js`, `services/voice/voiceReceptionistEngine.js`, `services/notifications/reminderScheduler.js`) calls one of its exported functions rather than touching a provider or template directly, so there is exactly one implementation of "what sending a notification means."

Providers implement an abstract interface (`EmailProvider.js` / `SMSProvider.js`) with a single documented contract:
```
{ success, simulated, providerMessageId, providerStatus, failureReason }
```
Adding a future vendor (e.g. Vonage, Postmark) means writing one new adapter class against that same interface — nothing else in the system changes.

## 3. SMS provider

**Twilio Programmable SMS** (`TwilioSMSProvider.js`), reusing the same Twilio account and `twilio` npm package Phase 4 already introduced for voice — no second vendor added without reason, per spec §22. `send()` calls `client.messages.create()`; "success" means Twilio's API accepted the message into its queue, never that it was delivered (delivery is confirmed later via the optional status-callback webhook). Known permanent failure codes (invalid number, blocked/opted-out destination) are classified so retry logic never retries them. `isConfigured()` checks `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_SMS_FROM_NUMBER` at call time — never assumed.

## 4. Email provider

**SendGrid**, called directly via Node's built-in `fetch` against `POST https://api.sendgrid.com/v3/mail/send` (`SendGridEmailProvider.js`) — no new npm dependency added. Success is only reported on HTTP 202; the `providerMessageId` comes from SendGrid's own `x-message-id` response header, never fabricated. `isConfigured()` checks `SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL`.

## 5. Demo vs. production behavior

`services/notifications/index.js` gates provider selection the same way Phases 2 and 4 gate calendar/voice providers: `practice.demoMode !== false` **always** returns the mock provider, no matter what `integrations.smsProvider`/`integrations.emailProvider` say. A real provider is only ever selected when a practice's static config file sets **both** `demoMode: false` and the matching `integrations.*Provider` key — never flippable from the admin dashboard or a request parameter (`practiceMerge.js` hard-codes `demoMode` and `integrations` as base-config-only invariants, with an explicit test proving it).

Mock providers (`MockEmailProvider.js`, `MockSMSProvider.js`) always return `success:false, simulated:true` with `providerMessageId:null` — they never fabricate an ID or claim delivery, and log a clearly-labeled "Demo notification simulated successfully" event. `notificationService.js` records these as `status:'simulated'`, and both the admin dashboard and notification history display them under a distinct "Simulated (demo)" label, never "Sent."

## 6. Reminder architecture

`services/notifications/reminderScheduler.js` exposes `getReminderOffsetsHours(practice)` (default `[24]`, but a practice can configure any set, e.g. `[48, 24, 2]`) and a pure function `findDueReminders({ practice, appointments, now })` that computes, per appointment and per configured offset, the exact UTC instant a reminder becomes due — using the practice's own IANA timezone (`utils/timezone.js`), never server local time. It skips cancelled appointments, appointments whose time has already passed, and unparseable dates/times, rather than guessing.

`processDueReminders()` is the only place this module does real I/O: it polls every practice, computes what's due, and calls `notificationService.notifyAppointmentReminder()` for each. `startReminderScheduler()` runs this on a 60-second `setInterval`, started from `server.js` only outside test mode, and `.unref()`ed so it never keeps the process alive by itself.

**Honest limitation, stated plainly (spec §9):** this is a `setInterval` polling loop, not a persistent job queue like BullMQ/Redis. It is nonetheless safe against the specific failure modes the spec calls out — server restart, multiple instances, and race conditions — because the actual duplicate-prevention guarantee is a MongoDB **unique index** on `NotificationLog.idempotencyKey`, enforced by `NotificationLogRepository.claim()`'s atomic insert, not by the poller's timing. Two instances polling simultaneously will both compute the same "due" list, but only one's `claim()` call will succeed; the other gets a duplicate-key error and skips. **Recommended production upgrade:** BullMQ + Redis, or a serverless cron job, calling the same `processDueReminders()`/`notificationService` functions — this module's pure logic would not need to change.

## 7. Inbound SMS architecture

`services/sms/smsReceptionistEngine.js` gives patients a real conversational channel over SMS, reusing the existing AI/receptionist stack rather than building a second AI: it shares `services/voice/voiceBookingFlow.js` (channel-agnostic — text in, text out) unchanged, and falls back to the same `services/receptionistEngine.js#understand()` used by the public chat widget for anything outside an in-progress flow. An SMS conversation is keyed `sms:<digits>`, which can never collide with a voice `CallSid`. Priority order mirrors the voice engine exactly: emergency keyword detection first (before anything else, including an in-progress flow), then flow continuation, then AI understanding, then flow start / human handoff / FAQ passthrough. There is no "transfer to a human" TwiML concept here (SMS has nothing to dial) — a handoff is created as a data record instead.

`routes/smsWebhook.js` (`POST /api/sms/incoming`) is the thin adapter: resolve practice + verify signature (via `middleware/smsPracticeContext.js`) → call the engine → reply with Twilio Messaging TwiML. `POST /api/sms/status` receives Twilio's delivery-status callback and updates the matching `NotificationLog` record.

## 8. Webhook security

Both SMS webhook endpoints are protected by `middleware/smsPracticeContext.js`, which resolves the practice **only** from the texted-to (`To`) number — never anything else in the request body — then verifies Twilio's request signature via `twilio.validateRequest(authToken, signatureHeader, fullUrl, params)`, the exact HMAC-SHA1 scheme already used for voice webhooks in Phase 4. A forged or missing signature is rejected with 403 before any business logic runs. A retried/duplicate status webhook applies the identical idempotent update rather than creating a second effect (tested explicitly). This has been tested against fixtures/fakes only — see §17 for what remains unverified against Twilio's live signing.

## 9. Template system

`services/notifications/templates.js` defines six notification types (`appointment_confirmation`, `appointment_rescheduled`, `appointment_cancelled`, `appointment_reminder`, `human_handoff`, `emergency_alert`), each in English and Urdu, written entirely in terms of `{{variable}}` placeholders — no practice name, phone number, or other identity is ever hard-coded, and this is directly tested (no template string anywhere contains "SmileVerse"). Supported variables: `practiceName`, `patientName`, `serviceName`, `appointmentDate`, `appointmentTime`, `practicePhone`, `practiceEmail`.

Sanitization is defense-in-depth: `fillTemplate()` only recognizes `{{identifier}}` syntax, strips all HTML tags from every substituted value, and the assembled email body is additionally fully HTML-escaped when building the HTML part — so a patient-supplied name containing `<script>` or `onerror=` can never survive into any rendered SMS or email. A language variant that doesn't exist for a given type falls back to English rather than failing. Roman Urdu is intentionally **not** implemented — no practice configures it, and the spec is explicit it should only exist if a practice deliberately turns it on.

## 10. Admin dashboard changes

Two new pages under `/admin`: **Notifications** (status tiles for demo/live per channel, provider configuration status, aggregate sent/failed/simulated counts, and an editable settings form for SMS/email enable toggles and reminder lead times) and **Notification History** (a table of individual notification records with masked destinations and a clear Sent/Failed/Simulated badge). An account with zero notifications sent sees real zeros and an empty state — never sample data. `emergencyAlertsAlwaysOn: true` is reported but is not a toggle; there is no way to disable emergency clinic alerts from this dashboard.

## 11. Practice isolation

Every new model and repository method is practice-scoped exactly like the rest of the codebase: `NotificationLog.practiceId` is required and indexed, and `NotificationLogRepository`'s every method takes `practiceId` explicitly. The admin routes read `req.practiceId`/`req.practice` from the authenticated session context set by existing auth middleware — **never** from a request body or query parameter — so one practice's admin can never see or affect another's notification history, settings, or stats. This is covered by an explicit cross-practice test (`adminNotificationsRoutes.test.js`'s "PRACTICE ISOLATION" case) proving practice B sees zero of practice A's data even when practice A has real history rows.

## 12. Security review

- Provider credentials (Twilio, SendGrid) are read from `process.env` server-side only; nothing is ever sent to the frontend.
- Webhook signature verification is enforced before any business logic (see §8).
- `practiceId` for every protected admin endpoint comes from the authenticated session, never the request body/params.
- Template rendering sanitizes all substituted values and rejects unrecognized placeholders (see §9) — no arbitrary HTML/JS can reach a rendered notification.
- `NotificationLog` never stores rendered message content, provider API keys, or OAuth tokens — only metadata (see §14).
- `providerMessageId` is deliberately excluded from the admin history API response — it never reaches the frontend.
- Structured logs (see §16) never include secrets, tokens, or full message bodies.
- Notification history endpoints require authentication (`requireAuth` middleware) — tested to return 401 with no session.
- Input validation: `validation.js`'s `isValidEmail`/`isValidPhone` gate every send; `settingsValidation.js`'s `validateNotificationSettingsPatch` gates the admin settings endpoint (booleans only for toggles, 1–5 positive numbers ≤336h for reminder offsets) and never accepts `smsPhoneNumber`/`clinicAlertPhone`/`clinicAlertEmail` — those remain base-config-only invariants.
- Retries are bounded (max 3 attempts) and idempotency-safe — see §15.

## 13. What is genuinely live

Nothing sends a real SMS or a real email in this build. What genuinely works end-to-end today, against real infrastructure: the full booking/reschedule/cancel/handoff/emergency flow calling into the notification service and correctly producing structured, honestly-labeled **simulated** results via the mock providers; the reminder scheduler computing real due-reminder lists off real appointment data; the inbound SMS conversational engine (reusing the real AI and booking flow) when driven by a real Twilio webhook, *once* the SMS provider is switched to live Twilio credentials — the webhook signature verification code path is real and would reject an actually-forged request, but has only been tested against fixtures, never a live Twilio account.

## 14. What is mocked

- Both providers default to mock for every practice, since every practice's config still has `demoMode: true`.
- `TwilioSMSProvider` and `SendGridEmailProvider` are fully written and unit-tested for their success/failure/error-classification logic, but have never made a real network call to Twilio or SendGrid in this session — no live credentials exist here to test against.
- The reminder scheduler is an in-process polling loop, not a real persistent job queue (see §6's honest limitation).

## 15. Reminder/notification idempotency & retry

Every send goes through a two-phase claim: `NotificationLogRepository.claim()` performs an atomic `insert` against a **unique index** on `idempotencyKey` (`practiceId:type:appointmentId/handoffId/conversationId:type:channel[:offset]`) *before* any provider call is attempted. A duplicate key means "already claimed," and the caller skips sending — this is what makes duplicate-prevention safe across restarts, multiple instances, and race conditions; the guarantee lives in the database, not application timing.

`services/notifications/retry.js` retries only temporary failures, up to 3 attempts with exponential backoff, and never retries a classified permanent failure (invalid phone/email, blocked destination, provider-not-configured, consent declined) — retrying those would never succeed and could look like spamming a blocked/invalid destination.

## 16. Observability

Every notification attempt logs one structured JSON line with `notificationId`, `practiceId`, `appointmentId`, `channel`, `type`, `provider`, `status`, `failureReason`, and `attempts` — never a provider API key/token, never the rendered message body, never unnecessary patient content beyond what's already an identifier.

## 17. Required environment variables

```
# Reused from Phase 4 (same Twilio account)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=

# New for Phase 5 — SMS
TWILIO_SMS_FROM_NUMBER=
TWILIO_SMS_STATUS_CALLBACK_URL=        # optional
SMILEVERSE_SMS_PHONE_NUMBER=

# New for Phase 5 — Email
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=                   # must be a SendGrid-verified sender
SENDGRID_FROM_NAME=
```
None of these are required for the app to run today — every practice remains fully functional in Demo Mode without any of them set.

## 18. Provider setup requirements to go live

1. **SMS:** In the Twilio Console, buy/use a number, set its "A message comes in" webhook to `https://<your-domain>/api/sms/incoming` and its status callback to `https://<your-domain>/api/sms/status` (both must be HTTPS in production — signature verification fails over plain HTTP). Set `TWILIO_SMS_FROM_NUMBER` and `SMILEVERSE_SMS_PHONE_NUMBER` to that number.
2. **Email:** Create a SendGrid API key with mail-send scope, verify a sender identity (Single Sender or domain verification — SendGrid rejects unverified From addresses), set `SENDGRID_API_KEY`/`SENDGRID_FROM_EMAIL`/`SENDGRID_FROM_NAME`.
3. In the target practice's config file (e.g. `config/practices/smileverse-dental.js`), deliberately set `demoMode: false` and `integrations: { smsProvider: 'twilio', emailProvider: 'sendgrid' }`. This is an intentional, reviewed code change — never something toggled from the admin UI.
4. Before trusting it with real patients: send at least one real test SMS and one real test email, confirm they arrive, and confirm the admin dashboard/notification history correctly show them as "Sent" (not "Simulated").

## 19. Test results, production build, and remaining blockers

**Backend:** `npm test` → **355 passed, 0 failed** (up from the Phase 4 baseline of 259; all pre-existing tests still pass with zero regressions). Coverage includes: demo/production SMS and email, successful/failed sends, appointment confirmation/reschedule/cancellation (including booking/reschedule/cancel-failure → no notification sent), reminder due/not-due/cancelled/past/invalid-date boundary cases, duplicate reminder prevention, invalid phone/invalid email rejection, human handoff and emergency clinic alert notifications, emergency-notification-never-blocks-the-emergency-response (proven with never-resolving fake promises), notification history, cross-practice isolation, webhook signature verification (valid/forged/missing), duplicate webhook idempotency, bounded retry logic (temporary vs. permanent classification), language/template selection with fallback, and confirmation that no provider secret/message-ID ever reaches the frontend.

**Frontend:** `react-scripts test` → 5/5 passing (pre-existing suite; no Phase 5-specific frontend tests were added given the pattern of the existing two test files, which cover routing/rendering smoke tests only). `npm run build` → compiled successfully, no errors or new warnings.

**Manually verified:** the backend server boots cleanly with all new routes and the reminder scheduler registered (confirmed via a direct boot test — the only error is an expected local MongoDB connection refusal, since no database is running in this environment).

**Remaining blockers / honest gaps:**
- Real Twilio/SendGrid credentials have never been used — nothing here has been proven against a live provider account. Live delivery must be smoke-tested once real credentials exist (see §18 step 4).
- The reminder scheduler is a single-process polling loop; a real multi-instance production deployment should migrate to a persistent job queue (see §6).
- No HIPAA compliance is claimed anywhere in this system.
- Excluded by design, per spec: dental PMS integrations, payment processing, subscriptions, marketing automation/recall campaigns, insurance verification APIs, a full CRM, advanced analytics, and any real Twilio *voice* setup beyond what Phase 4 already established.
