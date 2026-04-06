# BotArgento Embedded Signup Backend

Registration and control-plane backend for onboarding business clients to WhatsApp Business through Meta's Embedded Signup flow (Tech Provider architecture).

## Tech Stack

- **Hono** — HTTP framework
- **TypeScript** — Strict mode, ES2022
- **SQLite** — via better-sqlite3 (WAL mode)
- **Drizzle ORM** — Schema, migrations, queries
- **Zod v4** — Runtime validation
- **pino** — Structured JSON logging
- **Railway** — Deployment (Docker + persistent volume)

## Quick Start

### Prerequisites

- Node.js 20 LTS
- pnpm 9+
- A Meta Business App configured as a Tech Provider (see [Meta App Setup](#meta-app-setup))

### Setup

```bash
# Install dependencies
pnpm install

# Copy env file and fill in values
cp .env.example .env

# Generate encryption key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate admin API key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Run database migrations
pnpm db:migrate

# Start development server
pnpm dev
```

The server starts at `http://localhost:3000`.

### Verify

```bash
# Health check
curl http://localhost:3000/health

# Readiness check (validates DB + env vars)
curl http://localhost:3000/ready
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start dev server with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run production server from `dist/` |
| `pnpm lint` | TypeScript type checking |
| `pnpm test` | Run all tests (Vitest) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply pending migrations |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `META_APP_ID` | Yes | — | Facebook App ID |
| `META_APP_SECRET` | Yes | — | Facebook App Secret |
| `META_CONFIG_ID` | Yes | — | Facebook Login for Business config_id |
| `META_WEBHOOK_VERIFY_TOKEN` | Yes | — | Verify token for Meta app-level webhook |
| `META_API_VERSION` | No | `v25.0` | Graph API version |
| `META_SOLUTION_ID` | No | — | Only if using multi-partner solution flow |
| `META_SYSTEM_USER_TOKEN` | No | — | Only for optional token debug/inspection |
| `ENCRYPTION_KEY` | Yes | — | 64 hex chars (32 bytes) for AES-256-GCM |
| `ADMIN_API_KEY` | Yes | — | Admin endpoint auth key |
| `DATABASE_PATH` | No | `./data/botargento.db` | SQLite file path |
| `CORS_ORIGINS` | No | `https://botargento.com.ar,...` | Comma-separated allowed origins |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `info` | pino log level |

## API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check (DB + required env) |
| `GET` | `/api/meta/embedded-signup/config` | Public Meta config for frontend SDK |
| `POST` | `/api/meta/embedded-signup/sessions` | Create onboarding session |
| `GET` | `/api/meta/embedded-signup/sessions/:id` | Get session status |
| `POST` | `/api/meta/embedded-signup/complete` | Complete signup (exchange code, save assets) |
| `POST` | `/api/meta/embedded-signup/events` | Log cancel/error/completed events from frontend |

### Meta Webhook (control-plane)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/webhooks/meta/whatsapp` | Webhook verification (Meta subscription handshake) |
| `POST` | `/api/webhooks/meta/whatsapp` | Receive app-level events (e.g. `account_update`) |

### Admin (requires `X-Admin-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/onboarding` | List sessions (`?status=`, `?limit=`, `?offset=`) |
| `GET` | `/api/admin/onboarding/:id` | Full session detail with audit log |
| `POST` | `/api/admin/onboarding/:id/reconcile` | Retry failed steps using stored token |
| `POST` | `/api/admin/onboarding/:id/activate-webhook` | Activate per-tenant webhook override |
| `POST` | `/api/admin/onboarding/:id/rotate-credentials` | Rotate token with new auth code |

## Onboarding Flow

```
1. User opens onboarding page
2. Frontend fetches config from GET /config
3. User enters org name -> POST /sessions (status: started)
4. Frontend loads FB SDK, calls FB.login() with config_id, response_type: 'code'
5. Frontend captures WA_EMBEDDED_SIGNUP message events (success/cancel/error)
6. On success: frontend POST /complete with code + asset IDs (within 30s code TTL)
7. On cancel/error: frontend POST /events with event metadata
8. Backend: exchange code -> persist business/WABA/phone -> subscribe app -> register phone -> encrypt & store token
9. Status: assets_saved
10. Admin later activates per-tenant webhook override -> status: webhook_ready
```

### Reconcile (retry failed steps)

- Reconcile only retries post-token-exchange steps using the stored business token
- Token exchange has a 30-second code TTL and is not retryable
- If no stored token exists, a fresh Embedded Signup completion is required

## Database

SQLite with WAL mode enabled. 9 tables:

- `organizations` — Business clients
- `onboarding_sessions` — Signup flow state machine
- `onboarding_events` — WA_EMBEDDED_SIGNUP frontend payloads (success/cancel/error)
- `meta_business_accounts` — Meta Business account IDs
- `whatsapp_business_accounts` — WABA IDs + subscription status
- `phone_numbers` — WhatsApp phone numbers
- `credentials` — Encrypted tokens (AES-256-GCM), scoped by org + type
- `webhook_events` — Idempotent event log
- `audit_logs` — Every state transition

### Migrations

Migrations live in `src/db/migrations/`. Apply with:

```bash
pnpm db:migrate
```

After schema changes in `src/db/schema.ts`:

```bash
pnpm db:generate  # generates new migration SQL
pnpm db:migrate   # applies it
```

## Deployment (Railway)

### First Deploy

1. Create a Railway project
2. Add a **volume** mounted at `/data`
3. Connect the GitHub repo (or use `railway up`)
4. Set all required environment variables in Railway dashboard
5. Set `DATABASE_PATH=/data/botargento.db`
6. Set `NODE_ENV=production`
7. Railway auto-builds via `Dockerfile` and starts the container

### Custom Domain

Point `api.botargento.com.ar` to Railway's generated domain via CNAME.

### Backups

```bash
# Run backup via Railway CLI
railway run ./scripts/backup-db.sh

# Download to local machine
railway run cat /data/botargento.db > local-backup.db
```

## Meta App Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create or select a Business App configured as a **Tech Provider**
3. Add the **Facebook Login for Business** product
4. Create a Configuration (WhatsApp Embedded Signup) with these permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
5. Note the `config_id`
6. Subscribe the app to the `account_update` webhook
7. Set the webhook callback URL to `https://your-domain/api/webhooks/meta/whatsapp`
8. Note the App ID and App Secret from Settings > Basic

**Optional** (not required for Tech Provider baseline):
- `META_SOLUTION_ID` — only if using multi-partner solution flow
- `META_SYSTEM_USER_TOKEN` — only for optional token debug/inspection

## Project Structure

```
embedded-signup-backend/
src/
  config/env.ts              # Zod-validated environment
  db/
    schema.ts                # Drizzle table definitions (9 tables)
    client.ts                # SQLite connection (WAL mode)
    migrations/              # SQL migration files
  middleware/
    admin-auth.ts            # X-Admin-Key validation
    cors.ts                  # CORS with configured origins
    error-handler.ts         # Global error handler
    rate-limit.ts            # IP-based rate limiting
  routes/
    health.ts                # /health + /ready
    embedded-signup.ts       # Public onboarding API
    meta-webhooks.ts         # Meta app-level webhook (verification + events)
    admin.ts                 # Admin management API
  services/
    crypto.ts                # AES-256-GCM encrypt/decrypt
    meta-graph.ts            # Shared Graph API fetch helper
    meta-auth.ts             # Token exchange + optional debug
    meta-waba.ts             # WABA subscribe + phone register
    onboarding.ts            # Session management + reconcile + webhook activation
    onboarding-complete.ts   # Full signup orchestration
    persist-assets.ts        # Idempotent asset persistence (upsert helpers)
    audit.ts                 # Audit + webhook event logging
  types/
    meta.ts                  # Meta API types
    api.ts                   # Internal API types
  app.ts                     # Hono app factory
  index.ts                   # Server entry point
```

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

Tests use in-memory SQLite (`:memory:`) with migrations applied at setup.

## License

ISC
