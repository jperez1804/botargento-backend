#!/usr/bin/env bash
# ===========================================
# Export the SQLite database from the Railway service to a local file.
# ===========================================
#
# Prerequisites (one time):
#   railway login            # opens the browser
#   railway link             # pick workspace → project → environment → service
#
# Usage:
#   ./scripts/export-railway-db.sh [output-file]      (default: ./backups/railway-export.db)
#
# How it works:
#   1. Inside the container, better-sqlite3's online backup API writes a consistent
#      snapshot to /tmp/export.db (safe while the server runs; WAL is folded in).
#   2. The snapshot is streamed out base64-encoded (binary over `railway ssh` is not
#      safe on Windows terminals) and decoded locally.
#   3. The local file is opened read-only to verify it is a valid SQLite database.
#
# NOTE: `railway run <cmd>` runs <cmd> on YOUR machine with Railway's env vars, not in
# the container. Only `railway ssh` executes inside the deployed container.

set -euo pipefail

OUT="${1:-./backups/railway-export.db}"
mkdir -p "$(dirname "$OUT")"

echo "[1/3] Creating consistent snapshot inside the Railway container..."
railway ssh -- sh -c 'cd /app && node -e "require(\"better-sqlite3\")(\"/data/botargento.db\", {readonly:true}).backup(\"/tmp/export.db\").then(function(){console.log(\"snapshot ok\")})"'

echo "[2/3] Downloading snapshot (base64)..."
railway ssh -- sh -c 'base64 /tmp/export.db' | tr -d '\r' > "${OUT}.b64"
base64 -d "${OUT}.b64" > "$OUT"
rm -f "${OUT}.b64"

echo "[3/3] Verifying..."
HEADER=$(head -c 15 "$OUT")
if [ "$HEADER" != "SQLite format 3" ]; then
  echo "ERROR: $OUT is not a SQLite database (header: '$HEADER')" >&2
  exit 1
fi
SIZE=$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")
echo "OK: $OUT ($SIZE bytes)"
echo "Row counts:"
node -e "
const db = require('better-sqlite3')(process.argv[1], { readonly: true });
for (const t of ['organizations','onboarding_sessions','whatsapp_business_accounts','phone_numbers','credentials','audit_logs'])
  console.log('  ' + t.padEnd(28) + db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n);
" "$OUT"
