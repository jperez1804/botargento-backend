# BotArgento Embedded Signup Backend

Backend service for Meta WhatsApp Embedded Signup onboarding. Captures signup data, exchanges tokens, persists Meta identifiers, and supports two-stage webhook activation.

## Commands

- `pnpm dev` — Start dev server with tsx watch
- `pnpm build` — Compile TypeScript to dist/
- `pnpm start` — Run production server from dist/
- `pnpm lint` — Run TypeScript type checking
- `pnpm test` — Run Vitest tests
- `pnpm db:generate` — Generate Drizzle migrations
- `pnpm db:migrate` — Apply migrations

## Tech Stack

Hono + TypeScript + SQLite (better-sqlite3) + Drizzle ORM + Zod + pino + Railway

## Architecture

### Directory Structure
- `src/config/` — Environment validation (fail-fast on missing vars)
- `src/db/` — Drizzle schema + SQLite client (WAL mode)
- `src/routes/` — Hono route handlers (health, embedded-signup, meta-webhooks, admin)
- `src/services/` — Business logic (meta-auth, meta-waba, onboarding, persist-assets, crypto)
- `src/middleware/` — CORS, rate-limit, admin-auth, error-handler
- `src/types/` — Meta API types, internal API types

### Data Flow
Frontend onboarding page → POST /api/meta/embedded-signup/complete → onboarding service → meta-auth service (token exchange) → meta-waba service (subscribe, register) → crypto service (encrypt) → Drizzle → SQLite

### Key Patterns
- All request bodies validated with Zod before reaching service layer
- All Meta API calls go through dedicated service modules, never called directly from routes
- Tokens encrypted with AES-256-GCM before storage, decrypted only when needed for API calls
- Audit log entry for every state transition
- Standard response shape: `{ success: boolean, data?: T, error?: { code, message } }`
- Onboarding statuses: started → signup_completed → assets_saved → webhook_ready | failed
- ULID for all primary keys (sortable, no auto-increment)

## Code Organization Rules

1. **One service per concern.** meta-auth, meta-waba, onboarding, crypto are separate files.
2. **Routes are thin.** Validate input, call service, return response. No business logic in routes.
3. **All Meta API field names match official docs exactly.** Use `config_id`, `solutionID`, `waba_id`, `phone_number_id`, `override_callback_uri`, `verify_token`, `messaging_product`.
4. **Never expose secrets in responses.** Admin endpoints return credential metadata only.
5. **Fail fast on env.** If a required env var is missing, crash at startup with a clear message.
6. **Max 250 lines per file.** Extract if longer.
7. **No barrel exports.** Import directly from source files.

## Environment Variables

### Required
| Variable | Description |
|----------|-------------|
| `META_APP_ID` | Facebook App ID |
| `META_APP_SECRET` | Facebook App Secret |
| `META_CONFIG_ID` | Facebook Login for Business config_id |
| `META_WEBHOOK_VERIFY_TOKEN` | Verify token for Meta app-level webhook |
| `ENCRYPTION_KEY` | 32-byte hex for AES-256-GCM |
| `ADMIN_API_KEY` | Admin auth key |

### Optional
| Variable | Default | Description |
|----------|---------|-------------|
| `META_API_VERSION` | `v25.0` | Graph API version |
| `META_SOLUTION_ID` | — | Only if using multi-partner solution flow |
| `META_SYSTEM_USER_TOKEN` | — | Only for optional token debug/inspection |
| `DATABASE_PATH` | `./data/botargento.db` | SQLite file path |
| `CORS_ORIGINS` | `https://botargento.com.ar,...` | Comma-separated allowed origins |
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `development` | development or production |
| `LOG_LEVEL` | `info` | pino log level |

## Reglas No Negociables

1. TypeScript strict mode. No `any` types. No `ts-ignore`.
2. Never store plaintext tokens. Always encrypt with crypto service.
3. Never return raw credentials in API responses. Metadata only.
4. Every status transition gets an audit log entry.
5. All Zod schemas must be defined and validated before service calls.
6. Meta field names must match official documentation exactly.
7. Do not add webhook processing for runtime WhatsApp messages — that is handled by tenant n8n instances.
8. SQLite WAL mode must be enabled on connection.
9. All timestamps are ISO 8601 strings.
10. CORS must be restricted to configured origins only.
