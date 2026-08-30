# Phase 6 — Open Dental PMS Integration (MVP)

Status: implemented, fully test-covered against fakes, **not yet verified against a real Open Dental office** (no credentials exist in this environment). Read section 14 and 18 before assuming anything here is "live."

## 1. Files changed

**New backend files**
- `backend/services/pms/PMSErrors.js` — structured PMS error classes and the enumerated error-category vocabulary.
- `backend/services/pms/PMSProvider.js` — the abstract interface every PMS adapter implements.
- `backend/services/pms/MockPMSProvider.js` — the safe, always-available simulation used in Demo Mode.
- `backend/services/pms/OpenDentalPMSProvider.js` — the real Open Dental REST adapter.
- `backend/services/pms/index.js` — the demoMode-gated factory (`getPMSProvider`, `isPmsEnabled`).
- `backend/services/pms/pmsAppointmentProvider.js` — the orchestration adapter that implements the existing `AppointmentProvider` interface on top of a PMS.
- `backend/models/PMSSyncRecord.js`, `backend/repositories/PMSSyncRecordRepository.js` — the local↔PMS sync mapping.
- `backend/models/PMSAuditLog.js`, `backend/repositories/PMSAuditLogRepository.js` — the safe audit trail.
- `backend/routes/adminPMS.js` — admin status/test-connection/settings endpoints.
- `backend/tests/pmsProviderSelection.test.js`, `openDentalPMSProvider.test.js`, `mockPMSProvider.test.js`, `pmsAppointmentProvider.test.js`, `adminPMSRoutes.test.js`, `receptionistToolsPMS.test.js` — new test files (see section 19).

**New frontend files**
- `frontend/src/admin/pages/PMSSettingsPage.jsx` — the admin dashboard page.

**Modified backend files**
- `backend/services/providers/index.js` — added the PMS-routing branch, checked before the demoMode/calendar switch.
- `backend/models/Appointment.js` — added `pmsProvider`, `pmsAppointmentId`, `pmsPatientId`.
- `backend/config/practices/smileverse-dental.js` — added the `pms` config block (defaults to `pmsProvider: 'none'`, fully inert).
- `backend/services/practice/practiceMerge.js` — added `pms` merge rules.
- `backend/models/PracticeSettings.js` — added the admin-overridable `pms` mapping fields.
- `backend/services/practice/settingsValidation.js` — added `validatePmsSettingsPatch`.
- `backend/utils/appointmentErrorResponse.js` — extended with PMS-specific error branches.
- `backend/server.js` — mounted `routes/adminPMS`.
- `backend/.env.example` — documented the two required Open Dental env vars plus two optional ones.
- `backend/tests/providerSelection.test.js`, `settingsValidation.test.js`, `practiceMerge.test.js` — extended with PMS-routing/validation/merge-rule tests.

**Modified frontend files**
- `frontend/src/admin/services/adminApi.js` — added the four PMS API calls.
- `frontend/src/admin/components/AdminLayout.jsx` — added the "Open Dental (PMS)" nav item.
- `frontend/src/admin/AdminApp.jsx` — added the `/admin/pms` route.
- `frontend/src/admin/AdminApp.test.js` — extended with two PMS page tests.

**Deleted**
- `backend/services/providers/PMSProvider.js` — an unused stub from an earlier phase, superseded by the richer interface above.

**Nothing else touched.** The existing booking/calendar/voice/SMS/email code paths, the public marketing website, and every other Phase 1–5 file are unchanged (verified by the full regression run in section 19).

## 2. PMS architecture

```
Receptionist (web widget / voice / inbound SMS)
        |
        v
tools/receptionistTools.js   <-- ONE shared implementation, unchanged this phase
        |
        v
services/providers/index.js  <-- getAppointmentProvider(practice)
        |
        +-- practice.integrations.pmsProvider === 'none'  -->  Demo / Google Calendar path (Phase 2, unchanged)
        |
        +-- practice.integrations.pmsProvider !== 'none'  -->  PMSAppointmentProvider
                                                                       |
                                                                       v
                                                          services/pms/index.js: getPMSProvider(practice)
                                                                       |
                                                    +------------------+------------------+
                                                    |                                     |
                                          demoMode !== false                    demoMode === false
                                                    |                                     |
                                                    v                                     v
                                          MockPMSProvider                     OpenDentalPMSProvider
```

`PMSAppointmentProvider` (in `pmsAppointmentProvider.js`) implements the exact same `AppointmentProvider` interface `DemoAppointmentProvider` and `GoogleCalendarAppointmentProvider` already implement, so `tools/receptionistTools.js` needed **zero code changes** — it already only ever calls `getAppointmentProvider(practice)` and then `.getAvailability()` / `.createAppointment()` / etc. That single fact satisfies the spec's hardest constraint: the receptionist genuinely does not know, and cannot tell, whether it's talking to Open Dental or the mock — proven directly in `tests/receptionistToolsPMS.test.js`.

Two independent safety switches, checked at two different layers:
1. `integrations.pmsProvider` (checked in `services/providers/index.js`) decides whether a practice uses a PMS at all, instead of the calendar path. A clinic uses one or the other, never both, so no duplicate-booking-across-two-systems risk exists.
2. `demoMode` (checked one layer down, in `services/pms/index.js`) decides mock vs. real **within** the PMS path. A `demoMode: true` practice with `pmsProvider: 'openDental'` configured still always gets `MockPMSProvider` — this is enforced in code, not by convention, and is covered by `tests/pmsProviderSelection.test.js`.

## 3. Open Dental API endpoints actually used

All endpoint paths were taken from Open Dental's own public documentation (opendental.com/site/apisetup.html, apiappointments.html, apipatients.html, and the API Specification PDF), never invented and never copied from an unofficial tutorial. None of this has been exercised against a real account (see section 14).

| Endpoint | Purpose | Confidence |
|---|---|---|
| `GET /patients?LName=&FName=&Birthdate=&Phone=&Email=` | Patient search | High |
| `POST /patients` | Create patient | High |
| `GET /appointments?PatNum={PatNum}` | A patient's appointments | High |
| `GET /appointments/Slots?date=&ProvNum=&OpNum=&lengthMinutes=` | Open slots | High |
| `GET /providers` | Provider directory | High |
| `GET /operatories` | Operatory directory | High |
| `GET /appointmenttypes` | Appointment-type directory | Lower — kept off the critical booking path; fails soft to `[]` if unreachable or shaped unexpectedly |
| `POST /appointments` | Create appointment | High |
| `PUT /appointments/{AptNum}` | Reschedule | High |
| `PUT /appointments/{AptNum}/Break` | Cancel (Open Dental's own "Broken" status semantic — deliberately not a `DELETE`, since nothing in the docs suggested delete is the correct verb for this resource) | High |

Auth: `Authorization: ODFHIR {developerKey}/{customerKey}` on every request, both keys read only from `process.env`. Every request has a 10-second timeout via `AbortController`.

## 4. Patient identification flow

1. `_resolvePatient()` searches Open Dental by **phone first** — never by name alone.
2. If zero matches and the caller said "existing patient," the flow throws `PATIENT_NOT_FOUND` and the AI is told to say it can't find that patient rather than inventing one.
3. If more than one match shares that phone number (e.g. a family), the last name the caller gave narrows the set. If narrowing still leaves more than one match, the flow throws `MULTIPLE_PATIENT_MATCH` — the AI asks for another identifying detail. The error object carries only a match **count**, never the other patients' names or data.
4. If zero matches and the caller is a new patient, a new Open Dental patient record is created — but only once first name, last name, and phone are all present; if any are missing, the flow asks for them rather than creating an incomplete record.

## 5. Availability flow

`check_availability()` (used identically by web/voice/SMS) → `PMSAppointmentProvider.getAvailability()` → resolves the practice's configured (or PMS-directory-default) provider/operatory → calls the PMS's own `getAvailability()`/`/appointments/Slots` → reshapes the result into the same `{time, minutes}` slot shape every other provider in this codebase already returns, so nothing downstream (the booking UI, the voice flow, the SMS flow) needed to change. Business-hours/open-day logic (which days a practice is even open) stays practice-level, not PMS-level, exactly like the Demo/Google providers. Availability is **never** calculated from SmileVerse's own local database when a PMS is active — it always comes from a live call to the PMS.

## 6. Booking flow

1. Identify the patient (section 4).
2. Resolve the requested service to an Open Dental appointment-type ID via `practice.pms.serviceMappings` — if no mapping exists for a real (non-mock) PMS, the flow throws `INVALID_CONFIGURATION` rather than guessing, and the patient is told the clinic needs to confirm that appointment type.
3. Resolve provider/operatory via `practice.pms.providerMappings`/`operatoryMappings`, falling back to the PMS's own directory's first entry if unmapped — never a hard-coded ID.
4. **Re-check the exact slot immediately before booking** (a fresh `getAvailability()` call) — this is the double-booking guard against stale availability the patient saw a few messages ago. If the slot is no longer free, `SLOT_UNAVAILABLE` is thrown (and now audited as a failure — see section 11) before any PMS write is attempted.
5. Only after that re-check passes does the code call the PMS's create-appointment endpoint.
6. Only after the PMS genuinely returns a confirmed appointment ID does the code create a local `Appointment` document and a `PMSSyncRecord`.
7. Only after both of those succeed does the existing Phase 5 SMS/email confirmation get triggered.

If the PMS call itself fails, no local appointment is created, no confirmation is sent, and the caller is told the truth (see section 15).

## 7. Cancellation flow

Identify the correct local appointment → if it has a `pmsAppointmentId`, call Open Dental's own cancel semantic (`PUT /appointments/{AptNum}/Break`, not a `DELETE` — see section 3) → only on PMS success does the local record get marked `Cancelled` and the sync record updated → only then does the existing Phase 5 cancellation notification fire. An appointment that was never PMS-backed (e.g. created before this practice had a PMS) is still cancelled locally without calling the PMS, since there's nothing PMS-side to cancel.

## 8. Reschedule flow

Identify the current appointment → resolve the new date/time's provider/operatory → **re-check the new slot's availability immediately before committing** (same guard as booking; now also audited as `reschedule_failed` if it fails) → call the PMS's update endpoint → only on PMS confirmation does the local record's date/time/status update and the sync record move to `rescheduled`. On any failure, the original appointment is left completely untouched — no local state is ever written before the PMS confirms.

## 9. Provider/operatory mapping

`practice.pms.providerMappings.default.openDentalProvNum` and `practice.pms.operatoryMappings.default.openDentalOpNum` are the admin-configurable, per-practice mappings (JSON-editable from the new dashboard page). If unmapped, the code asks the PMS's own `/providers`/`/operatories` directory and uses its first entry — this always reflects the real PMS's own data, never an invented number like "provider 1 = the dentist."

## 10. Local ↔ Open Dental synchronization model

`PMSSyncRecord`: `{ practiceId, localAppointmentId, externalAppointmentId, externalPatientId, provider, syncStatus, createdAt, updatedAt, lastSyncedAt }`, with `syncStatus` one of `linked | pending | failed | cancelled | rescheduled`. Two compound unique indexes — `{practiceId, localAppointmentId}` and `{practiceId, externalAppointmentId}` — both enforce one-to-one mapping and double as idempotency protection: `linkAppointment()` checks for an existing record before creating one, and additionally catches MongoDB's duplicate-key error (11000) as a race-condition fallback, mirroring Phase 5's notification idempotency pattern. Open Dental (once live) is the source of truth for patient identity, PMS appointment state, and provider/operatory/appointment-type IDs; this app's local `Appointment` collection remains the one shape the rest of the app (notifications, admin dashboard) already knows how to read, and no second, competing appointment database was created.

## 11. Security review

- **Credentials are server-side only.** `OPENDENTAL_DEVELOPER_KEY`/`OPENDENTAL_CUSTOMER_KEY` are read exclusively from `process.env` inside `OpenDentalPMSProvider`'s constructor. There is no code path — admin route, settings validator, or model — anywhere in this codebase that accepts or stores an API key value coming from the frontend. `validatePmsSettingsPatch`'s schema simply never reads a credential-shaped field, so one included in a request body is silently dropped, never persisted (verified in `tests/settingsValidation.test.js` and `tests/adminPMSRoutes.test.js`).
- **Practice isolation.** Every PMS operation resolves its practice from the authenticated server-side session (`req.practice`/`req.practiceId`), never from a request body, header, or query parameter. Verified for the admin routes in `tests/adminPMSRoutes.test.js` and for the orchestration layer in `tests/pmsAppointmentProvider.test.js`.
- **Admin authorization.** `routes/adminPMS.js` requires the same `requireAuth()` middleware every other admin route uses; all four endpoints return 401 when unauthenticated.
- **No secrets ever returned to the frontend.** `GET /admin/pms` and `POST /admin/pms/test-connection` return only `providerName`, `status`, booleans, timestamps, latency, and API version — never the credential values themselves, even when the underlying provider's own result object happened to carry one (explicitly tested).
- **Input validation.** `validatePmsSettingsPatch` rejects non-object bodies, non-object mapping groups, entries missing their required ID field, blank/invalid ID values, HTML/script content in mapping keys, and more than 100 entries per group.
- **Timeouts.** Every Open Dental request has a 10-second `AbortController` timeout, surfaced as `PMS_TIMEOUT`/`PMSUnavailableError('timeout')`, never a hang.
- **Retry safety / no accidental duplicate bookings.** Booking, reschedule, and cancel all re-check PMS state immediately before writing, and never write local state until the PMS itself confirms success — a retried request after a PMS timeout cannot silently create two appointments, because the local write only ever happens after a genuine PMS-confirmed response.
- **Audit logging.** See section 27 in the original spec / the `PMSAuditLog` model above — every patient lookup/creation, availability check, booking attempt/success/failure, cancellation, reschedule, and connection test is recorded with identifiers and outcomes only, never request/response bodies, never patient name/phone/DOB, never credentials (explicitly asserted in `tests/pmsAppointmentProvider.test.js`).
- **HIPAA.** This integration is **not** claimed to be HIPAA-compliant. Open Dental's own API documentation states that API developers should have a Business Associate Agreement (BAA) in place with the practices they serve — this is a real, required step before handling any live patient data through this integration, and is not something this codebase can satisfy on its own. See section 20.

## 12. Practice isolation tests

Covered explicitly in `tests/mockPMSProvider.test.js` ("PRACTICE ISOLATION: two different practiceIds never see each other's mock patients/appointments"), `tests/pmsAppointmentProvider.test.js` ("PRACTICE ISOLATION: two practices booking through the same PMS instance never see each other's local appointments"), and `tests/adminPMSRoutes.test.js` ("PRACTICE ISOLATION: admin B never sees admin A's PMS mappings, status, or audit history").

## 13. Demo Mode behavior

With `demoMode: true` (the default for every practice, including SmileVerse today), `services/pms/index.js` always returns `MockPMSProvider`, regardless of what `integrations.pmsProvider` says — there is no code path from a PMS-enabled, demoMode-true practice to a real Open Dental call. The admin dashboard's PMS page always shows "Demo Mode — Open Dental is not connected" in that state, with no fake "Connected" status, no fake patient records, and no fake sync statistics — the mapping counts and connection-test button reflect only what's genuinely configured.

## 14. What is genuinely live

**Nothing against a real Open Dental office.** No Open Dental developer/customer credentials exist in this environment, and none were used. SmileVerse's own config (`pmsProvider: 'none'`) keeps this whole feature inert for the current demo practice — exactly as before this phase. What IS genuinely live and working: the mock-backed PMS flow end-to-end (patient resolution, availability, booking, reschedule, cancel, search) through the real `PMSAppointmentProvider` orchestration code, and the admin dashboard's real status/settings/test-connection endpoints — all exercised with real code paths, just against `MockPMSProvider` instead of a real account.

## 15. What is mocked

- `MockPMSProvider`: an in-memory, per-practice simulation seeded with two patients (Sarah Ahmed, John Smith), generating real availability from the practice's own business hours, with real double-booking protection.
- Every `OpenDentalPMSProvider` test uses an injected fake `fetch` function returning canned HTTP responses — no real network calls were made to `api.opendental.com` at any point in this phase.
- The AI never fabricates PMS information: it only ever states what the PMS (mock or real) genuinely returned. If a PMS call fails, the receptionist says: "I'm having trouble accessing the clinic's appointment system right now. I can connect you with the front desk." — it never says "you're booked" without a confirmed PMS success.

## 16. Required Open Dental credentials/configuration to go live

- `OPENDENTAL_DEVELOPER_KEY` — obtained by registering as a developer with Open Dental (contact vendor.relations@opendental.com).
- `OPENDENTAL_CUSTOMER_KEY` — generated by the developer, then added by the customer (the dental office) inside their own Open Dental software under Setup → Advanced Setup → API → Add Key. One customer key per office.
- Optional: `OPENDENTAL_API_BASE_URL` (defaults to `https://api.opendental.com/api/v1`) and `OPENDENTAL_CLINIC_NUM` (only needed for a multi-location office).
- The practice's config file needs `demoMode: false` and `integrations.pmsProvider: 'openDental'` set — a deliberate, reviewed code change, never something the admin dashboard can flip.

## 17. Required clinic-side setup

- The office must have Open Dental with the API module enabled and must generate their own customer key as above.
- Front-desk staff (or whoever administers the SmileVerse dashboard) must fill in the Open Dental (PMS) settings page's service/provider/operatory mappings — matching this practice's own services to the clinic's real Open Dental appointment types, and (if not using the PMS's own directory default) its real provider/operatory numbers.
- The practice should sign a Business Associate Agreement (BAA) appropriate to this integration before any real patient data flows through it (see section 20).

## 18. Live connection status

**Not tested against a real office — no credentials available in this environment.** Open Dental integration code is implemented and test-covered against fakes, but live office verification is pending. When real credentials become available, the existing "Test Connection" button performs a genuine, safe, read-only request (`GET /patients?Limit=1`) that proves auth and reachability without creating or modifying anything, and that is the point at which this status can honestly change.

## 19. Test results

Full backend suite (`npm test`, `node --test`): **457 / 457 passing**, zero failures — this is the Phase 5 baseline plus every new Phase 6 test below, with zero regressions to any existing test.

New Phase 6 test files and counts:
- `tests/pmsProviderSelection.test.js` — 7 tests
- `tests/openDentalPMSProvider.test.js` — 25 tests
- `tests/mockPMSProvider.test.js` — 16 tests
- `tests/pmsAppointmentProvider.test.js` — 18 tests
- `tests/adminPMSRoutes.test.js` — 13 tests
- `tests/receptionistToolsPMS.test.js` — 6 tests
- Extensions to `tests/providerSelection.test.js` (+3 PMS-routing tests), `tests/settingsValidation.test.js` (+9 `validatePmsSettingsPatch` tests), `tests/practiceMerge.test.js` (+6 `pms` merge-rule tests)

Coverage includes: MockPMSProvider's full interface (patient found/not found/multiple matches, availability on open/closed days, booking success/double-booking-rejection, cancel, reschedule, practice isolation); OpenDentalPMSProvider against injected HTTP fakes covering every documented status code this integration handles (200s, 401/403 → auth failure, 404, 409 → slot conflict, 429 → rate limited, 500 → server error, malformed/missing-field responses, timeouts via simulated `AbortError`, network errors); the full orchestration layer (patient resolution with last-name narrowing, service-mapping resolution and its "missing mapping" failure, slot re-checking before booking/reschedule, sync-record creation/status transitions, audit-event content and its exclusion of patient name/phone); the admin routes (status reporting honesty across demo/not-enabled/not-configured/connected states, test-connection never leaking credentials, settings GET/PUT round-trip, practice isolation, 401s); and a dedicated proof that `tools/receptionistTools.js` — the single shared implementation behind web, voice, and SMS — needs zero code changes to route through a PMS-configured practice.

Frontend suite (`react-scripts test`): **7 / 7 passing** — the Phase 5 baseline of 5 plus 2 new tests for the PMS settings page (demo-mode status display with real mapping counts; Test Connection never rendering a credential-shaped field).

## 20. Production build result

`react-scripts build` completed successfully: "Compiled successfully." Bundle sizes: `main.js` 93.01 kB gzipped (+1.31 kB over the Phase 5 build, from the new PMS settings page and API client additions), `main.css` 7.62 kB gzipped (unchanged), one small chunk at 1.76 kB. No build warnings or errors.

## 21. Remaining blockers

- **No real Open Dental office is connected.** This is the single largest gap: everything above is implemented and tested against fakes, but has never made a real HTTP request to `api.opendental.com`. Getting a developer key, a test/demo office's customer key, and running the Test Connection button against it is the concrete next step before any claim of "live" integration is accurate.
- **No Business Associate Agreement exists.** Open Dental's own documentation calls for one before handling real patient data through their API — this is a legal/business step outside the scope of code changes.
- **`/appointmenttypes` is lower-confidence** and was deliberately kept off the critical booking path (fails soft to an empty array) — worth re-verifying against a real Developer Portal account before relying on it for anything beyond the optional admin-mapping helper.
- **Multi-location clinics** (multiple `OpenDentalPMSProvider` instances/clinic numbers per practice) are out of scope for this MVP — the current factory assumes one Open Dental customer key per practice.
- **PMS↔Google Calendar dual-sync** was explicitly out of scope this phase (a practice uses one or the other, never both) — a future phase would need a real strategy here if a clinic ever wants both systems to reflect the same calendar.
- Everything explicitly excluded from this phase's spec remains excluded: Dentrix/Denticon/CareStack/Eaglesoft, billing, claims, insurance verification APIs, treatment plans, prescriptions, clinical notes, radiographs, full chart sync, marketing automation, subscriptions, advanced recall, full CRM, advanced analytics.
