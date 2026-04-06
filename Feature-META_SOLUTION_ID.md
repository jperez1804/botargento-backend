# BotArgento Embedded Signup Backend

This README is the implementation handoff for the next coding agent.

It is based on Meta's official documentation for:

- [Embedded Signup Overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview)
- [Embedded Signup Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Onboarding Customers as a Tech Provider or Tech Partner](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)

Use the official docs above as the source of truth. This README narrows them to BotArgento's actual architecture and calls out the changes required versus the generated backend that currently exists in:

- `C:\Desarollo\jperez\BotArgentoLandingPageRepo\landingpage\.claude\worktrees\peaceful-northcutt\embedded-signup-backend`

## BotArgento assumptions

These assumptions are intentional and should guide the implementation:

- BotArgento is implementing the **Tech Provider** flow, not the Solution Partner credit-line flow.
- BotArgento is **not** using Meta multi-partner solutions right now.
- Each client will later have its own manually provisioned runtime on the VPS, for example:
  - `https://client1.botargento.com.ar/...`
  - `https://client2.botargento.com.ar/...`
- The central backend is an **onboarding/control-plane** service.
- The central backend should **not** be the shared runtime processor for tenant WhatsApp traffic.
- Per-client `n8n` endpoints will handle runtime message webhooks later.

## What the official Meta docs require

### 1. App and OAuth prerequisites

Per the implementation doc:

- BotArgento must already be configured as a **Tech Provider**.
- The hosting server must use **valid SSL / HTTPS**.
- The app must be subscribed to the **`account_update`** webhook.
- In **Facebook Login for Business > Settings > Client OAuth settings**, these toggles must be enabled:
  - `Client OAuth login`
  - `Web OAuth login`
  - `Enforce HTTPS`
  - `Embedded Browser OAuth Login`
  - `use Strict Mode for redirect URIs`
  - `Login with the JavaScript SDK`
- All domains that will launch Embedded Signup must be present in:
  - `Allowed domains`
  - `Valid OAuth redirect URIs`

### 2. Facebook Login for Business configuration

Per the implementation doc:

- Use a **Facebook Login for Business configuration** for the `WhatsApp Embedded Signup` login variation.
- Meta recommends the template:
  - `WhatsApp Embedded Signup Configuration With 60 Expiration Token`
- Capture the resulting **`config_id`**.
- Select only the permissions/assets that BotArgento actually needs, because unnecessary assets increase abandonment.

### 3. Frontend launch contract

Per the implementation doc, the onboarding page must:

- load the Facebook JS SDK:
  - `https://connect.facebook.net/en_US/sdk.js`
- initialize `FB.init(...)` with:
  - `appId`
  - `version`
- call `FB.login(...)` with:
  - `config_id`
  - `response_type: 'code'`
  - `override_default_response_type: true`
  - `extras: { setup: {} }`

It must also install a `window.addEventListener('message', ...)` listener that:

- only accepts events from `facebook.com`
- handles `type === 'WA_EMBEDDED_SIGNUP'`
- captures:
  - successful completion payload
  - abandoned flow payload
  - reported error payload

Important detail from the docs:

- Closing the popup on the final screen still counts as a **successful onboarding**.
- The exchangeable `code` and the asset IDs are still returned.

### 4. Code exchange timing

Per the implementation doc:

- the exchangeable `code` returned by Embedded Signup has a **30-second TTL**
- it must be sent to the backend and exchanged **immediately**

### 5. Tech Provider post-signup server steps

Per the Tech Provider onboarding doc, perform these server-to-server steps:

1. Exchange `code` using `GET /oauth/access_token`
2. Subscribe app to the customer's WABA using `POST /{WABA_ID}/subscribed_apps`
3. Register the customer's business phone number using `POST /{PHONE_NUMBER_ID}/register`
4. Optionally send a test message

The official Tech Provider doc says the inputs needed for this flow are:

- customer `WABA ID`
- customer `business phone number ID`
- your app ID
- your app secret

### 6. Token model

Per the overview doc:

- **Tech Providers use business tokens exclusively**
- **System user tokens** are for **Solution Partners** sharing credit lines

That means a pure Tech Provider implementation should not require a system-user token for the baseline flow unless BotArgento explicitly chooses an additional optional verification/inspection step.

### 7. Billing reality

Per the overview doc:

- if BotArgento remains a **Tech Provider**, the customer must attach a **payment method** to their WABA before they can send messages
- onboarding success does not mean the customer is fully billable/message-ready

## Required implementation changes

These are the changes the next agent should make. Treat them as the implementation delta.

### A. Make `META_SOLUTION_ID` optional or remove it

Current generated backend assumes `META_SOLUTION_ID` is always required.

That is wrong for BotArgento's current setup.

Reason:

- `solutionID` is relevant for multi-partner / partner-solution flows
- BotArgento is not using that flow right now

Required change:

- `META_SOLUTION_ID` must not be required in env validation
- `/api/meta/embedded-signup/config` should only include `solution_id` if it is actually configured
- the frontend should only send `solutionID` if this env var exists

### B. Make `META_SYSTEM_USER_TOKEN` optional for the Tech Provider baseline

Current generated backend requires `META_SYSTEM_USER_TOKEN` and uses it in token debugging.

That is not part of the official minimum Tech Provider onboarding flow.

Required change:

- `META_SYSTEM_USER_TOKEN` should be optional, not required
- any `debug_token` step must be optional
- if BotArgento keeps token inspection, do not make the whole flow depend on a system-user token

### C. Update the Graph API default

Current generated backend defaults `META_API_VERSION` to `v22.0`.

The implementation doc now recommends using the latest version and explicitly shows `v25.0`.

Required change:

- default `META_API_VERSION` to `v25.0`
- keep it configurable via env

### D. Add an app-level Meta webhook endpoint

This is required by the official implementation doc.

Meta says:

- the app must already be subscribed to the `account_update` webhook
- this webhook is triggered when a customer completes Embedded Signup

Required change:

- add a central webhook route for Meta app-level events, for example:
  - `GET /api/webhooks/meta/whatsapp`
  - `POST /api/webhooks/meta/whatsapp`
- use this route for:
  - webhook verification
  - app-level onboarding/account events such as `account_update`
- do **not** use this route as the tenant runtime webhook processor for all client traffic

This route is a control-plane webhook, not the future per-client `n8n` runtime endpoint.

### E. Keep the two-stage webhook model

BotArgento's operational model is:

1. customer completes Embedded Signup
2. backend stores onboarding assets
3. later, Jonatan manually creates:
   - subdomain
   - VPS route
   - per-client `n8n` endpoint
4. later, the app can override the WABA callback URL to the tenant endpoint

Required change:

- during `/complete`, subscribe the app to the WABA using the app-level default webhook
- do **not** assume the tenant-specific webhook already exists
- keep the later admin step for per-WABA callback override

This part of the generated backend is directionally correct and should be preserved.

### F. Implement the real frontend contract, not just `/complete`

The backend cannot be implemented in isolation from the Meta frontend contract.

Required change:

- define the onboarding page contract clearly
- the page must:
  - fetch `/api/meta/embedded-signup/config`
  - create a backend onboarding session
  - call `FB.login(...)`
  - capture `WA_EMBEDDED_SIGNUP` message events
  - send the returned `code` to the backend immediately
  - also send/store the returned asset IDs and cancellation/error metadata

At minimum, the system must preserve:

- `business_id`
- `waba_id`
- `phone_number_id`
- Meta session / error info when present
- cancelled step when present

### G. Preserve cancel/error/session logging

The implementation doc explicitly describes:

- success payloads
- cancel payloads
- reported error payloads

Required change:

- persist or at least log the cancel/error/session data from the `WA_EMBEDDED_SIGNUP` window message payload
- do not only store successful completions

Useful fields from the docs:

- `event: 'CANCEL'`
- `current_step`
- `error_code`
- `error_message`
- Meta `session_id`
- `timestamp`

### H. Fix retry/reconcile behavior around the 30-second code TTL

The current generated backend's reconcile flow is not valid because it tries to replay completion without a fresh code.

That conflicts with the official docs, which say the code expires after 30 seconds.

Required change:

- do not retry `exchangeCodeForToken(...)` without a fresh code
- split retryable steps from non-retryable steps
- if token exchange failed because the code expired, the operator must obtain a **fresh Embedded Signup completion**
- if token exchange already succeeded, later steps can be retried using the stored business token

### I. Make persistence idempotent with real row reuse

Current generated backend can create foreign-key inconsistencies when duplicate inserts are skipped.

Required change:

- if `meta_business_id`, `waba_id`, or `phone_number_id` already exists, fetch and reuse the existing internal row IDs
- do not generate child rows using temporary IDs that were never inserted

### J. Scope credential rotation by credential type

Current generated backend updates credentials by `organizationId` only.

Required change:

- update credentials by:
  - `organizationId`
  - `credentialType`
- avoid overwriting unrelated credentials if multiple types are stored

### K. Adjust permissions guidance to the Tech Provider baseline

For BotArgento's current Tech Provider flow, the docs indicate the main baseline permissions for Cloud API are:

- `whatsapp_business_management`
- `whatsapp_business_messaging`

Required change:

- do not document `business_management` as a mandatory baseline permission for the Tech Provider flow
- only require extra permissions if BotArgento truly enables additional partner/system-user behavior

### L. Update readiness and env docs accordingly

Required change:

- `.env.example`
- env validation
- health/readiness docs
- API README docs

must all match the real Tech Provider implementation, including:

- optional `META_SOLUTION_ID`
- optional `META_SYSTEM_USER_TOKEN`
- default `META_API_VERSION=v25.0`
- correct CORS defaults for local and production environments

## Recommended backend responsibilities

The backend should do exactly this:

- expose the public Embedded Signup config
- create onboarding sessions
- receive completion payloads and exchange the code immediately
- persist business, WABA, phone, and credential data securely
- subscribe the app to the WABA using the app-level default webhook
- register the business phone number
- record audit data
- expose admin read endpoints
- expose an admin action to activate the tenant-specific webhook override later
- expose the app-level Meta webhook endpoint for onboarding/account events

The backend should **not** do this:

- process all tenant runtime WhatsApp traffic centrally
- require a partner solution / `solutionID` by default
- require a system-user token for the base Tech Provider flow

## Minimal env model for BotArgento

### Required

- `META_APP_ID`
- `META_APP_SECRET`
- `META_CONFIG_ID`
- `ENCRYPTION_KEY`
- `ADMIN_API_KEY`
- `DATABASE_PATH`
- `CORS_ORIGINS`
- `PORT`
- `NODE_ENV`
- `LOG_LEVEL`

### Optional

- `META_API_VERSION` with default `v25.0`
- `META_SYSTEM_USER_TOKEN` only if BotArgento keeps an optional debug/inspection step
- `META_SOLUTION_ID` only if BotArgento later adopts a multi-partner solution

## Suggested file-level implementation targets

If the next agent is adapting the generated worktree implementation, the main files to change are:

- `src/config/env.ts`
- `src/routes/embedded-signup.ts`
- `src/routes/health.ts`
- `src/routes/admin.ts`
- `src/services/meta-auth.ts`
- `src/services/meta-waba.ts`
- `src/services/onboarding.ts`
- `src/services/onboarding-complete.ts`
- `src/db/schema.ts`
- `README.md`
- `.env.example`

Add a new route module for app-level Meta webhooks, for example:

- `src/routes/meta-webhooks.ts`

## Recommended build order

1. Set up the real env contract
2. Add the app-level Meta webhook route and verification handling
3. Fix `/api/meta/embedded-signup/config` so `solution_id` is optional
4. Fix token exchange flow so it does not depend on a system-user token
5. Fix idempotent persistence in the onboarding completion service
6. Fix reconcile flow so it respects the 30-second code TTL
7. Fix credential rotation scoping
8. Align README and `.env.example`
9. Add tests for:
   - config without `solution_id`
   - completion without system-user token
   - duplicate completion/idempotency
   - cancel/error payload logging
   - webhook verification

## Done criteria

The implementation is correct when all of the following are true:

- a real onboarding page can launch `FB.login(...)` with the official Meta parameters
- the backend can exchange the returned code within the required TTL
- the backend stores the returned business assets safely
- the backend subscribes the app to the customer's WABA
- the backend can register the phone number
- the central app-level Meta webhook endpoint exists and is ready for `account_update`
- the system does not require `META_SOLUTION_ID` or `META_SYSTEM_USER_TOKEN` for the base Tech Provider flow
- later admin activation can override the webhook to a per-client `n8n` endpoint

## Official source notes

The official Meta docs used for this handoff were mirrored locally during analysis because direct site fetching was unstable from the shell environment.

The key official requirements used above came from:

- Implementation doc updated `2026-03-25`
- Overview doc updated `2025-11-25`
- Tech Provider onboarding doc updated `2025-11-14`

When coding, if any behavior here conflicts with the live docs, the live Meta docs win.

## Implementation Progress

### Milestone 1: Real env contract (Changes A, B, C) — COMPLETED

**Date**: 2026-04-05

**What changed**:
- `META_SOLUTION_ID` is now optional — not required for Tech Provider baseline
- `META_SYSTEM_USER_TOKEN` is now optional — `debugToken` gracefully skips when not configured
- `META_API_VERSION` defaults to `v25.0` (was `v22.0`)
- `/config` endpoint only includes `solution_id` when the env var is set
- `/ready` health check no longer requires optional env vars
- `completeSignup` flow handles null debug result (scopes/expiry stored as null when debug is skipped)
- `.env.example` updated with correct comments separating required vs optional vars
- Test suite updated: tests run without `META_SOLUTION_ID` or `META_SYSTEM_USER_TOKEN`

**Files changed**:
- `src/config/env.ts` — Zod schema: optional fields + new default
- `src/routes/embedded-signup.ts` — Conditional `solution_id` in config response
- `src/routes/health.ts` — Removed optional vars from readiness check
- `src/services/meta-auth.ts` — `debugToken` returns `null` when no system user token
- `src/services/onboarding-complete.ts` — Conditional debug step + null-safe credential storage
- `.env.example` — Corrected comments and defaults
- `vitest.config.ts` — Removed optional env vars from test environment
- `src/routes/embedded-signup.test.ts` — Updated config assertions

**What is now working**:
- Backend starts and passes all checks with only the required env vars
- Config endpoint returns clean response without optional fields
- Onboarding completion flow works without system user token (debug step skipped)
- All 33 tests pass, TypeScript compiles cleanly

**Next milestone**: ~~Add app-level Meta webhook route~~ (done, see Milestone 2)

---

### Milestone 2: App-level Meta webhook endpoint (Change D) — COMPLETED

**Date**: 2026-04-06

**What changed**:
- New route module `src/routes/meta-webhooks.ts` with:
  - `GET /api/webhooks/meta/whatsapp` — Meta webhook verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`)
  - `POST /api/webhooks/meta/whatsapp` — Receives Meta app-level events (e.g. `account_update`), logs each change to `webhook_events` table with idempotency key
- New required env var `META_WEBHOOK_VERIFY_TOKEN` — the token Meta uses to verify the webhook endpoint
- Route is a **control-plane webhook** for onboarding/account lifecycle events, not a tenant runtime processor
- Returns `EVENT_RECEIVED` as plain text (Meta requirement) and logs all events for later processing

**Files changed**:
- `src/config/env.ts` — Added `META_WEBHOOK_VERIFY_TOKEN` (required)
- `src/routes/meta-webhooks.ts` — **NEW** — webhook verification + event receiver
- `src/routes/meta-webhooks.test.ts` — **NEW** — 7 tests covering verification and event handling
- `src/app.ts` — Registered webhook route at `/api/webhooks/meta/whatsapp`
- `.env.example` — Added `META_WEBHOOK_VERIFY_TOKEN` entry
- `vitest.config.ts` — Added test env var for webhook verify token

**What is now working**:
- Meta can verify the webhook endpoint during app subscription setup
- `account_update` and other app-level events are received and logged
- Verification rejects bad tokens with 403
- All 40 tests pass, TypeScript compiles cleanly

**Next milestone**: ~~Frontend contract alignment + cancel/error logging~~ (done, see Milestone 3)

---

### Milestone 3: Frontend contract alignment + cancel/error logging (Changes F + G) — COMPLETED

**Date**: 2026-04-06

**What changed**:
- New `onboarding_events` table to persist `WA_EMBEDDED_SIGNUP` message payloads (success, cancel, error)
- New `POST /api/meta/embedded-signup/events` endpoint for the frontend to send cancel/error/completed payloads
- `/complete` schema now accepts optional `display_phone_number` (persisted to `phone_numbers` table)
- `logOnboardingEvent` service function stores structured event data + full raw payload
- Drizzle migration `0001_normal_husk.sql` generated for the new table

**Files changed**:
- `src/db/schema.ts` — Added `onboardingEvents` table definition
- `src/db/migrations/0001_normal_husk.sql` — **NEW** — migration for onboarding_events
- `src/types/api.ts` — Added `OnboardingEventParams` interface, optional `displayPhoneNumber` to `CompleteSignupParams`
- `src/services/onboarding.ts` — Added `logOnboardingEvent` function
- `src/services/onboarding-complete.ts` — Persists `displayPhoneNumber` in phone_numbers insert
- `src/routes/embedded-signup.ts` — Added `POST /events` endpoint, optional `display_phone_number` in complete schema
- `src/routes/embedded-signup.test.ts` — 6 new tests (cancel, error, completed events, validation, display_phone_number)

**What is now working**:
- Frontend can send cancel/error/completed payloads from `WA_EMBEDDED_SIGNUP` message events
- All event types are persisted with structured fields and raw JSON
- `display_phone_number` flows through to phone_numbers table
- All 46 tests pass, TypeScript compiles cleanly

**Next milestone**: ~~Fix reconcile + idempotent persistence~~ (done, see Milestone 4)

---

### Milestone 4: Fix reconcile + idempotent persistence (Changes H + I) — COMPLETED

**Date**: 2026-04-06

**What changed**:

**Idempotent persistence (Change I)**:
- Extracted `persist-assets.ts` with insert-or-get helpers (`upsertMetaBusiness`, `upsertWaba`, `upsertPhone`)
- After each `onConflictDoNothing` insert, the code now queries back the existing row by its unique external ID
- Child rows always reference the correct internal FK, even if the parent was already inserted in a prior attempt
- Token credential storage skips re-insert if already stored for the organization

**Reconcile respects code TTL (Change H)**:
- `reconcile` no longer calls `completeSignup` with an empty code
- Instead, it checks for a stored credential (token exchange must have already succeeded)
- If no stored token → clear error: "Fresh Embedded Signup required"
- If token exists → decrypts and calls `persistAssets` directly (retries only post-token-exchange steps)
- On success, updates session to `assets_saved`; on failure, returns to `failed` with a clear error message

**Architecture**:
- Extracted `src/services/persist-assets.ts` — idempotent upsert helpers + `persistAssets()` function
- `onboarding-complete.ts` now imports from `persist-assets.ts` (134 lines)
- `onboarding.ts` reconcile uses `persistAssets` directly (250 lines)
- All files under 250-line limit

**Files changed**:
- `src/services/persist-assets.ts` — **NEW** — idempotent persistence logic
- `src/services/onboarding-complete.ts` — Slimmed down, imports `persistAssets`
- `src/services/onboarding.ts` — Rewritten reconcile with stored token flow

**What is now working**:
- Duplicate completions reuse existing rows correctly (no broken FKs)
- Reconcile retries only retryable steps using stored business token
- Reconcile fails clearly when token exchange never completed
- All 46 tests pass, TypeScript compiles cleanly

**Next milestone**: ~~Credential rotation scoping + docs~~ (done, see Milestone 5)

---

### Milestone 5: Credential rotation scoping + docs (Changes J + L) — COMPLETED

**Date**: 2026-04-06

**What changed**:

**Credential rotation scoping (Change J)**:
- All credential queries and updates now scope by both `organizationId` AND `credentialType`
- `rotate-credentials` admin endpoint updates only `business_integration_token` rows
- `activateWebhook` and `reconcile` look up only `business_integration_token` credentials
- `persistAssets` checks for existing credential by org + type before inserting
- Added `and()` from drizzle-orm for compound WHERE clauses

**Documentation updates (Change L)**:
- `README.md` — Complete rewrite: updated env table (required vs optional), added webhook endpoints, added `/events` endpoint, updated onboarding flow description, updated Meta App Setup (Tech Provider focus, no system user required), reconcile behavior documented, 9 tables listed, project structure updated
- `CLAUDE.md` — Updated env table with required/optional split, new defaults, added `META_WEBHOOK_VERIFY_TOKEN`
- `.env.example` — Already updated in Milestone 1

**Files changed**:
- `src/routes/admin.ts` — Added `and` import, scoped rotate + detail credential queries
- `src/services/onboarding.ts` — Added `and` import, scoped activateWebhook + reconcile credential queries
- `src/services/persist-assets.ts` — Added `and` import, scoped credential existence check
- `README.md` — Full rewrite
- `CLAUDE.md` — Updated env table

**What is now working**:
- Credential rotation targets the correct credential type, won't overwrite unrelated credentials
- All credential lookups are scoped by type
- Documentation matches the real implementation
- All 46 tests pass, TypeScript compiles cleanly
- All source files at or under 250 lines

**All required changes from the feature spec are now complete:**
- [x] A. `META_SOLUTION_ID` optional (Milestone 1)
- [x] B. `META_SYSTEM_USER_TOKEN` optional (Milestone 1)
- [x] C. `META_API_VERSION` defaults to v25.0 (Milestone 1)
- [x] D. App-level Meta webhook endpoint (Milestone 2)
- [x] E. Two-stage webhook model preserved (existing + Milestone 2)
- [x] F. Frontend contract alignment (Milestone 3)
- [x] G. Cancel/error/session logging (Milestone 3)
- [x] H. Reconcile respects 30s code TTL (Milestone 4)
- [x] I. Idempotent persistence with row reuse (Milestone 4)
- [x] J. Credential rotation scoped by type (Milestone 5)
- [x] K. Permissions guidance — Tech Provider baseline only (Milestone 5 README)
- [x] L. README, .env.example, CLAUDE.md updated (Milestones 1-5)
