# BotArgento Embedded Signup Backend

Registration and control-plane backend for onboarding business clients to WhatsApp Business through Meta's Embedded Signup flow.

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
- A Meta Business App (see [Meta App Setup](#meta-app-setup))

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
| `META_SOLUTION_ID` | Yes | — | Tech Provider Solution ID |
| `META_SYSTEM_USER_TOKEN` | Yes | — | System user access token |
| `META_API_VERSION` | No | `v22.0` | Graph API version |
| `ENCRYPTION_KEY` | Yes | — | 64 hex chars (32 bytes) for AES-256-GCM |
| `ADMIN_API_KEY` | Yes | — | Admin endpoint auth key |
| `DATABASE_PATH` | No | `./data/botargento.db` | SQLite file path |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `LOG_LEVEL` | No | `info` | pino log level |

## API Endpoints

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check (DB + env) |
| `GET` | `/api/meta/embedded-signup/config` | Public Meta config for frontend |
| `POST` | `/api/meta/embedded-signup/sessions` | Create onboarding session |
| `GET` | `/api/meta/embedded-signup/sessions/:id` | Get session status |
| `POST` | `/api/meta/embedded-signup/complete` | Complete signup (exchange code, save assets) |

### Admin (requires `X-Admin-Key` header)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/onboarding` | List all sessions (filter: `?status=`, `?limit=`, `?offset=`) |
| `GET` | `/api/admin/onboarding/:id` | Full session detail with audit log |
| `POST` | `/api/admin/onboarding/:id/reconcile` | Retry a failed session |
| `POST` | `/api/admin/onboarding/:id/activate-webhook` | Activate webhook override for a session |
| `POST` | `/api/admin/onboarding/:id/rotate-credentials` | Re-exchange token with new auth code |

### Admin Examples

```bash
# List all sessions
curl -H "X-Admin-Key: YOUR_KEY" https://api.botargento.com.ar/api/admin/onboarding

# Get session detail
curl -H "X-Admin-Key: YOUR_KEY" https://api.botargento.com.ar/api/admin/onboarding/SESSION_ID

# Activate webhook for a completed session
curl -X POST -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" \
  -d '{"webhook_url":"https://n8n.example.com/webhook/wa","verify_token":"my-verify-tok"}' \
  https://api.botargento.com.ar/api/admin/onboarding/SESSION_ID/activate-webhook

# Retry a failed session
curl -X POST -H "X-Admin-Key: YOUR_KEY" \
  https://api.botargento.com.ar/api/admin/onboarding/SESSION_ID/reconcile
```

## Onboarding Flow

```
1. User opens onboarding/whatsapp.html
2. Frontend fetches config from GET /config
3. User enters org name → POST /sessions (status: started)
4. Frontend loads FB SDK, calls FB.login() with Embedded Signup
5. User completes Meta flow → frontend captures code + WABA data
6. Frontend POST /complete with all data
7. Backend: exchange code → debug token → save WABA → subscribe app → register phone → encrypt & store credentials
8. Status: assets_saved
9. Admin activates webhook override → status: webhook_ready
```

## Database

SQLite with WAL mode enabled. 8 tables:

- `organizations` — Business clients
- `onboarding_sessions` — Signup flow state machine
- `meta_business_accounts` — Meta Business account IDs
- `whatsapp_business_accounts` — WABA IDs + subscription status
- `phone_numbers` — WhatsApp phone numbers
- `credentials` — Encrypted tokens (AES-256-GCM)
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

The backup script:
- Uses SQLite `.backup` API for a consistent snapshot (safe during writes)
- Falls back to file copy if `sqlite3` CLI is unavailable
- Rotates old backups (keeps 10 by default)
- Configurable via `BACKUP_DIR`, `MAX_BACKUPS` env vars

## Meta App Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create or select a Business App
3. Add the **Facebook Login for Business** product
4. Create a Configuration with these permissions:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   - `business_management`
5. Note the `config_id`
6. In Tech Provider settings, note the `solution_id`
7. Create a **System User** in Business Settings → System Users
8. Generate a token with required permissions
9. Note the App ID and App Secret from Settings → Basic

## Project Structure

```
embedded-signup-backend/
├── src/
│   ├── config/env.ts              # Zod-validated environment
│   ├── db/
│   │   ├── schema.ts              # Drizzle table definitions
│   │   ├── client.ts              # SQLite connection (WAL mode)
│   │   └── migrations/            # SQL migration files
│   ├── middleware/
│   │   ├── admin-auth.ts          # X-Admin-Key validation
│   │   ├── cors.ts                # CORS with configured origins
│   │   ├── error-handler.ts       # Global error handler
│   │   └── rate-limit.ts          # IP-based rate limiting
│   ├── routes/
│   │   ├── health.ts              # /health + /ready
│   │   ├── embedded-signup.ts     # Public onboarding API
│   │   └── admin.ts               # Admin management API
│   ├── services/
│   │   ├── crypto.ts              # AES-256-GCM encrypt/decrypt
│   │   ├── meta-graph.ts          # Shared Graph API fetch helper
│   │   ├── meta-auth.ts           # Token exchange + debug
│   │   ├── meta-waba.ts           # WABA subscribe + phone register
│   │   ├── onboarding.ts          # Session management
│   │   ├── onboarding-complete.ts # Full signup orchestration
│   │   └── audit.ts               # Audit + webhook event logging
│   ├── types/
│   │   ├── meta.ts                # Meta API types
│   │   └── api.ts                 # Internal API types
│   ├── app.ts                     # Hono app factory
│   └── index.ts                   # Server entry point
├── scripts/
│   └── backup-db.sh               # Database backup with rotation
├── Dockerfile                     # Multi-stage production build
├── railway.toml                   # Railway deploy config
├── drizzle.config.ts              # Drizzle Kit config
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── .env.example
└── CLAUDE.md
```

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch
```

Tests use in-memory SQLite (`:memory:`) with migrations applied at setup. 33 tests across 4 files covering crypto, health, embedded-signup routes, and admin routes.

## License

ISC
