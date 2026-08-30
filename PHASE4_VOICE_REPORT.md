# Phase 4 — Production-Grade AI Voice Receptionist: Final Report

## 1. Files changed

**New backend files (18):**
- `backend/services/receptionistEngine.js` — shared "understand a message" core, now used by both web chat and voice
- `backend/services/voice/TelephonyProvider.js` — telephony interface
- `backend/services/voice/SpeechToTextProvider.js` — STT interface
- `backend/services/voice/TextToSpeechProvider.js` — TTS interface
- `backend/services/voice/MockTelephonyProvider.js` — demo/dev telephony provider
- `backend/services/voice/TwilioTelephonyProvider.js` — real Twilio adapter
- `backend/services/voice/TwilioNativeSpeechProvider.js` — STT pass-through (Twilio's built-in recognition)
- `backend/services/voice/TelephonyNativeTextToSpeechProvider.js` — TTS pass-through (Twilio's built-in `<Say>`)
- `backend/services/voice/twimlBuilder.js` — shared TwiML XML builders
- `backend/services/voice/index.js` — provider factory (demoMode-gated, mirrors the Phase 2 calendar-provider pattern)
- `backend/services/voice/naturalDateTimeParser.js` — English/Roman Urdu/Urdu-script date & time parsing
- `backend/services/voice/voiceBookingFlow.js` — deterministic booking/cancel/reschedule state machine
- `backend/services/voice/voiceReceptionistEngine.js` — voice orchestrator (emergency → flow → shared engine → handoff)
- `backend/middleware/voicePracticeContext.js` — resolves practice from dialed number + verifies webhook signature
- `backend/routes/voice.js` — the three Twilio webhook endpoints
- `backend/routes/adminVoice.js` — admin Voice status + Call History API
- `backend/models/CallLog.js` — one document per call
- `backend/repositories/CallLogRepository.js` — CallLog data access + aggregation

**New frontend files (2):**
- `frontend/src/admin/pages/VoicePage.jsx`
- `frontend/src/admin/pages/CallHistoryPage.jsx`

**New test files (11, 70 new tests):**
`receptionistEngine.test.js`, `voiceBookingFlow.test.js`, `voiceReceptionistEngine.test.js`, `practiceRepository.voice.test.js`, `voicePracticeContext.test.js`, `voiceRoutes.test.js`, `adminVoiceRoutes.test.js`, `voiceProviderSelection.test.js`, `naturalDateTimeParser.test.js`, `voiceObservability.test.js`, plus an extension to `tests/helpers/invokeRoute.js`.

**Modified files (9):**
- `backend/routes/chat.js` — rewritten as a thin adapter over `receptionistEngine` (same external behavior/response shapes, verified byte-for-byte against the old logic in tests)
- `backend/services/conversationStore.js` — 6 new voice-only slot fields added, always null/0 for web conversations
- `backend/config/practices/smileverse-dental.js` — added `integrations.voiceProvider` and a `voice.phoneNumber` block (env-sourced)
- `backend/config/practiceRepository.js` — added `getPracticeIdForPhoneNumber()`
- `backend/services/practice/practiceMerge.js` — `voice` added to the never-admin-overridable invariant list
- `backend/server.js` — added `express.urlencoded()`, `trust proxy`, mounted `/api/voice/*` (before `practiceContext`) and `adminVoice` routes
- `backend/package.json` / `package-lock.json` — added the `twilio` dependency (21 packages, no native bindings)
- `backend/.env.example` — documented the new Twilio/voice env vars and webhook URLs
- `frontend/src/admin/services/adminApi.js`, `AdminLayout.jsx`, `AdminApp.jsx` — Voice + Call History nav/routes/API calls

**Deleted:**
- `backend/services/voice/VoiceReceptionist.js` — the Phase-1-era placeholder stub, superseded by the real implementation above. **I could not delete this file on your computer from here — please delete it yourself** (nothing in the codebase references it anymore, confirmed by search before removal on my side).

## 2. Voice architecture

One rule above everything else: **there is exactly one receptionist intelligence, used by every channel.** `services/receptionistEngine.js` is the single place that runs the deterministic emergency check, calls the AI provider, merges conversation memory, and logs analytics — `routes/chat.js` (web) and `services/voice/voiceReceptionistEngine.js` (voice) are both thin adapters over it. Nothing about FAQs, pricing, hours, insurance, or intent classification is duplicated for voice.

What voice adds on top, because a phone call has no clickable UI:
- **Deterministic emergency check first, always** — even mid-booking-flow, before the AI or the booking state machine ever sees the utterance.
- **A separate, non-AI booking/cancel/reschedule state machine** (`voiceBookingFlow.js`) — once the shared engine detects that intent, control passes to this state machine, which is the *only* thing ever allowed to call the real `create_appointment`/`cancel_appointment`/`reschedule_appointment` functions, and only after an explicit spoken "yes."
- **Immediate human transfer** for a `human_handoff` intent — unlike web (which only shows a button the patient must click), a phone call has no button, so `voiceReceptionistEngine.js` creates the real handoff record and transfers right away.

## 3. Telephony provider

**Twilio Voice**, chosen deliberately (not the only option, but the right one for this project): its built-in `<Gather input="speech">` and `<Say>` mean no separate real-time speech network integration is needed, and it has mature, well-documented webhook-signature verification. `TwilioTelephonyProvider` is fully written — real HMAC-SHA1 signature verification via the official `twilio` npm package, real TwiML generation — but it has **never been exercised against a real Twilio account or a real phone call**. It is only ever selected when a practice has both `demoMode: false` and `integrations.voiceProvider: 'twilio'` in its static config file — the exact same two-key gate Phase 2 uses for the calendar provider. Every practice ships today with neither set, so every call this app can currently handle runs on `MockTelephonyProvider`, which produces byte-for-byte identical TwiML for identical inputs (same shared `twimlBuilder.js`).

## 4. Speech-to-text provider

`TwilioNativeSpeechProvider` — honestly, a thin pass-through, not a second network integration. With Twilio Voice, speech recognition happens *inside* the telephony leg itself: Twilio POSTs the already-transcribed text (`SpeechResult`) to `/api/voice/gather`. The `SpeechToTextProvider` interface exists so a future provider needing genuine separate STT (raw audio, a non-Twilio telephony provider) has a seam without touching `routes/voice.js`.

## 5. Text-to-speech provider

`TelephonyNativeTextToSpeechProvider` — same honest pattern: Twilio's own `<Say>` voice speaks the text; no separate synthesis call happens today. The `TextToSpeechProvider` interface is the seam for a future custom/branded voice (ElevenLabs, Polly directly, etc.).

## 6. What is genuinely live

- The deterministic emergency classifier, running before anything else on every voice turn (same logic as web, now shared code).
- The full booking/cancel/reschedule flow's business logic — real availability checks, real `create_appointment`/`cancel_appointment`/`reschedule_appointment` calls, real analytics logging, real SMS/email notification hooks (mocked providers, same as web).
- Real webhook signature verification code (`twilio.validateRequest`), real phone-number-to-practice resolution, real CallLog persistence to MongoDB.
- The full test suite: **257 backend tests passing, 0 failures, 0 regressions** (started this phase at 187; net +70 new tests across 11 new files). Frontend: 5/5 passing, production build succeeds.

## 7. What is mocked / not yet real

- **No real phone call has ever been placed to or received by this system.** Everything above has been verified through automated unit/integration tests with fake telephony providers — not a live Twilio account.
- `TwilioTelephonyProvider` has zero real-world exercise. `MockTelephonyProvider` is what every practice actually runs on today (`demoMode: true` by default).
- Voice booking-flow *prompts* ("What day would you like to come in?" etc.) are English-only text today. The flow already *understands* yes/no/dates/handoff-requests in English, Roman Urdu, **and Urdu script** (I extended the date/time parser to add Urdu-script day names and time-of-day words, which the flow's confirmation/date logic didn't originally have) — but it always speaks its own questions in English. This is documented in the code, not hidden.
- Call recording/transcripts: conversation history is stored (same in-memory store as web, keyed by CallSid), but no audio recording, retention policy, or practice-level enable/disable toggle exists yet — out of scope for "don't build a database you don't need yet."

## 8. Required environment variables

Added to `backend/.env.example`:
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from the Twilio Console; required for both real calls and real webhook signature verification.
- `SMILEVERSE_VOICE_PHONE_NUMBER` — the practice's Twilio number in E.164 format (e.g. `+15551234567`); this is the *only* thing that ever resolves which practice a call belongs to.

## 9. Webhook configuration

Point the Twilio number's Voice webhook ("A call comes in") at:
```
https://<your-railway-app>.up.railway.app/api/voice/incoming
```
and its optional status callback at:
```
https://<your-railway-app>.up.railway.app/api/voice/status
```
Both must be HTTPS in production — Twilio signature verification fails over plain HTTP. `middleware/voicePracticeContext.js` reads `X-Forwarded-Proto`/`X-Forwarded-Host` (Railway terminates TLS in front of the app), and `server.js` now sets `app.set('trust proxy', true)` so the reconstructed URL matches what Twilio actually signed.

## 10. Admin dashboard changes

Two new nav items: **Voice** (status: live/demo, provider, phone number, and real stat tiles — total/answered/transferred/missed calls, appointment conversions, average duration, all real aggregates from `CallLog`, reporting honest zeros when there's no history) and **Call History** (practice-scoped, authenticated, per-call outcome/duration/turn count). The Voice page explicitly states "Emergency safety is always on" — there is no admin toggle to disable it, by design.

## 11. Security review

- **Webhook signature verification**: implemented via `twilio.validateRequest`, tested for valid/invalid/missing signature (`tests/voicePracticeContext.test.js`, `tests/voiceProviderSelection.test.js`).
- **Practice isolation**: a call is identified *only* by the dialed ("To") number, resolved via `config/practiceRepository.js#getPracticeIdForPhoneNumber` against each practice's static config — never anything caller-supplied. Tested explicitly (a body field claiming a different `practiceId` is ignored).
- **`voice.phoneNumber` is never admin-overridable** — added to `practiceMerge.js`'s existing invariant list (alongside `demoMode`/`integrations`/`compliance`) and tested.
- **No secrets in logs**: structured JSON logs include practiceId/callSid/provider/verification-outcome, never the signature value or auth token (explicit test in `voiceObservability.test.js`).
- **No secrets in the frontend bundle**: Twilio credentials never touch `frontend/`; production build inspected.
- **Rate limiting**: not added in this phase — the existing app has none for any route, and adding it project-wide was out of this phase's scope; noted as a gap below.
- **Replay protection**: Twilio's signature scheme is time-bound but the app doesn't independently reject old signed requests; acceptable for now, worth revisiting before production.

## 12. Emergency safety verification

The deterministic keyword classifier (`services/emergencyService.js`, unchanged) runs first on every voice turn — before the shared AI engine, before the booking flow, unconditionally. Tests confirm: (a) a life-threatening utterance short-circuits before the AI engine is ever called; (b) a life-threatening utterance *mid-booking-flow* interrupts and clears the flow rather than being swallowed as a date/time answer. Emergency safety cannot be disabled from the admin dashboard.

## 13. Practice isolation verification

Tests confirm: an unconfigured phone number is rejected (safe TwiML, never a default/guessed practice); a caller-supplied `practiceId` field is ignored; `voice.phoneNumber` cannot be changed via the admin settings API; CallLog and Voice-dashboard stats are practice-scoped (admin B never sees admin A's call data).

## 14. Test results

**Backend: 257/257 passing, 0 failures** (`node --test`). **Frontend: 5/5 passing** (`react-scripts test`). Coverage added this phase: voice session/flow logic, emergency-before-AI and emergency-interrupts-flow, practice isolation via phone number, webhook signature verification (valid/invalid/missing/mock-mode), provider factory demoMode gating, natural-language date/time parsing in English/Roman Urdu/Urdu script, language-switching mid-flow, sensitive-data-not-logged, admin Voice/Call History endpoints, and full route-level tests for all three voice webhooks (incoming/gather/status) including the failure path (engine throws → caller still gets a spoken transfer, never dead air).

## 15. Production build result

Backend: all files pass `node --check`. Frontend: `npm run build` compiles successfully (90.65 kB main bundle, +914 B from this phase). No build errors or warnings introduced.

## 16. Remaining blockers (to genuinely go live)

1. A real Twilio account, phone number, and its Account SID/Auth Token.
2. Setting `demoMode: false` and `integrations.voiceProvider: 'twilio'` in `config/practices/smileverse-dental.js`, plus `SMILEVERSE_VOICE_PHONE_NUMBER` in the environment.
3. Pointing that Twilio number's webhooks at the deployed `/api/voice/incoming` and `/api/voice/status` URLs.
4. An actual test phone call to confirm the whole path end-to-end — **this has never been done**, and nothing in this report should be read as claiming otherwise.
5. Translating the booking flow's own spoken prompts into Urdu, if full Urdu voice booking (not just FAQ) is wanted.
6. Deciding a call-recording/transcript retention policy before handling real patient calls, and adding rate limiting to the public voice/chat endpoints.

## 17. Exact steps to make real phone calls work

```
1. Create a Twilio account, buy a phone number with Voice capability.
2. In Railway's environment variables, set:
   TWILIO_ACCOUNT_SID=<from Twilio Console>
   TWILIO_AUTH_TOKEN=<from Twilio Console>
   SMILEVERSE_VOICE_PHONE_NUMBER=+1<your Twilio number, E.164 format>
3. Edit backend/config/practices/smileverse-dental.js:
   demoMode: false
   integrations.voiceProvider: 'twilio'
   (commit and push this — it's a deliberate code change, not an admin toggle)
4. In the Twilio Console, under your number's Voice Configuration:
   "A call comes in" -> Webhook -> https://<your-app>.up.railway.app/api/voice/incoming (HTTP POST)
   "Call status changes" -> https://<your-app>.up.railway.app/api/voice/status (optional, HTTP POST)
5. Call the number from a real phone and listen. If it doesn't work, check Railway's logs for
   the structured "voice_webhook_received" line — it will show signatureValid:false with a reason
   if Twilio's signature check is failing (usually a URL/proxy mismatch).
```

---

*A note on the CRITICAL constraints from the spec: nothing in this report claims a real phone call has been placed or received, nothing claims a real appointment was booked outside of a test's fake provider confirming it, and nothing claims HIPAA compliance. The existing web receptionist, admin dashboard, and calendar provider architecture were not touched beyond what's listed above, and the full pre-existing test suite still passes unchanged.*
