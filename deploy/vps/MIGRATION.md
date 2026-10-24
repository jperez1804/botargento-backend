# Railway → VPS migration runbook

Context: Railway's October 2026 security disclosure (variables possibly read). The move
to the Hostinger VPS doubles as the secret rotation: **every secret is regenerated on the
VPS**, and the Railway database is copied and re-encrypted under a new key.

Legend: **[J]** = needs Jonatan (root on VPS, Meta dashboard, Cloudflare, Railway UI).
Everything else can be driven from this repo.

## 0. One-time prerequisites

- `railway login` then `railway link` (workspace → project → environment → backend service).
- `ssh vps` works (deploy user).
- GitHub repo can publish to GHCR (same permissions model as the dashboard repo).

## 1. Publish the image

1. Merge `.github/workflows/release.yml` to `main`. The push builds
   `ghcr.io/jperez1804/botargento-backend:latest` and `:sha-<commit>`.
2. `gh run watch` until green. **[J]** If the package is private, make it public or add a
   GHCR pull token on the VPS (`docker login ghcr.io`), same as the dashboard image.

## 2. Prepare the VPS directory **[J]**

```bash
sudo mkdir -p /opt/n8n/control-plane
sudo chown deploy:deploy /opt/n8n/control-plane
```

Then from the laptop:

```bash
scp deploy/vps/backend.compose.yml vps:/opt/n8n/control-plane/backend.compose.yml
scp deploy/vps/backend.env.example vps:/opt/n8n/control-plane/backend.env
ssh vps 'chmod 0600 /opt/n8n/control-plane/backend.env'
```

## 3. Generate fresh secrets

On the VPS, fill `backend.env`:

| Variable | Source |
|---|---|
| `META_APP_ID`, `META_CONFIG_ID`, `META_SOLUTION_ID` | Same values as Railway (public identifiers). |
| `META_APP_SECRET` | **[J]** Meta App Dashboard → Settings → Basic → *Reset App Secret*. Paste the new one. |
| `META_WEBHOOK_VERIFY_TOKEN` | `openssl rand -hex 32`. Update Meta App Dashboard → Webhooks in step 7. |
| `ENCRYPTION_KEY` | `openssl rand -hex 32`. This is the **NEW** key for step 5. |
| `ADMIN_API_KEY` | `openssl rand -hex 32`. Update every caller of `/api/admin/*`. |
| `META_SYSTEM_USER_TOKEN` | **[J]** Only if used: regenerate in Business Settings → System Users. |

Keep the **OLD** `ENCRYPTION_KEY` from Railway at hand for step 5 only. Never write it to the VPS.

## 4. Export the Railway database

```bash
./scripts/export-railway-db.sh ./backups/railway-export.db
```

Prints row counts. Keep this file until the migration is confirmed; it is encrypted with
the old key and is useless without it.

## 5. Re-encrypt under the new key (locally)

```bash
OLD_ENCRYPTION_KEY=<railway key> NEW_ENCRYPTION_KEY=<vps key> \
  node scripts/rotate-encryption-key.mjs ./backups/railway-export.db --dry-run
# then without --dry-run
```

The script aborts with no writes if any row fails to decrypt with the old key.

## 6. Seed the VPS volume and start

```bash
# create the named volume and copy the db in
ssh vps 'docker volume create botargento_backend_data'
scp ./backups/railway-export.db vps:/home/deploy/botargento.db
ssh vps 'docker run --rm -v botargento_backend_data:/data -v /home/deploy:/src alpine sh -c "cp /src/botargento.db /data/botargento.db && chown 1000:1000 /data/botargento.db" && rm /home/deploy/botargento.db'

# start
ssh vps 'cd /opt/n8n/control-plane && docker-compose --env-file backend.env -f backend.compose.yml pull backend && docker-compose --env-file backend.env -f backend.compose.yml up -d backend'
ssh vps 'docker logs --tail 50 botargento-backend'   # expect "Database migrations applied" + "Server running"
```

Smoke test **before** DNS, through Traefik, by pinning the host:

```bash
curl -sk --resolve api.botargento.com.ar:443:187.127.6.44 https://api.botargento.com.ar/health
curl -sk --resolve api.botargento.com.ar:443:187.127.6.44 -H "X-Admin-Key: <new key>" "https://api.botargento.com.ar/api/admin/onboarding?limit=3"
```

The certificate will be invalid until DNS points here (Let's Encrypt validates via DNS), so
`-k` is for the pre-cutover check only.

## 7. Cutover **[J]**

Reality check from 2026-10-24: the Railway service never had a custom domain. Everything
called `https://botargento-backend-production.up.railway.app` directly, so `api.botargento.com.ar`
did not exist and had to be **created**, and every caller had to be repointed.

1. Cloudflare: **add** an A record `api` → 187.127.6.44, DNS only (grey cloud).
2. Recreate the container (`up -d`). Traefik only retries a failed ACME challenge when the router
   is re-registered, so if the container started before the record existed this step is required.
   Confirm: `curl -sI https://api.botargento.com.ar/health` with a valid Let's Encrypt cert.
3. Onboarding page: set `API_BASE` to `https://api.botargento.com.ar/api/meta/embedded-signup`
   in the landing repo (`landingpage/v5/whatsapp.html`, published as `/whatsapp.html`) and upload.
4. Meta App Dashboard → WhatsApp → Configuration: callback URL
   `https://api.botargento.com.ar/api/webhooks/meta/whatsapp`, new verify token, *Verify and Save*.
   The backend logs `Meta webhook verification successful`.
5. Railway has no "stop": disconnect the GitHub repo in Settings (otherwise the next push
   redeploys there), then `railway down -y` removes the active deployment. Volume and variables
   stay for rollback until the project is deleted.
6. Run a real check: open the onboarding page, confirm it reaches the API (CORS unchanged).

## 8. Post-cutover

- Nightly backup on the VPS (deploy user crontab), see `deploy/vps/backup-cron.sh`.
- After 24 h with no issues **[J]**: delete the Railway service and project. This removes
  the leaked variables and ends the billing.
- Delete `./backups/railway-export.db*` locally and forget the old ENCRYPTION_KEY.
- Update README deployment section (Railway → VPS).

## Rollback (before step 8)

Railway dashboard → Redeploy the removed deployment, repoint the onboarding page and the Meta
webhook callback at the Railway URL, and set Meta's verify token back to the old value. Railway
still has the old secrets and the old database until the project is deleted.
