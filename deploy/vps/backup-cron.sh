#!/usr/bin/env bash
# Nightly consistent backup of the backend SQLite volume on the VPS.
#
# Install (deploy user):
#   cp deploy/vps/backup-cron.sh /home/deploy/backup-backend.sh && chmod +x /home/deploy/backup-backend.sh
#   crontab -e  →  0 3 * * * /home/deploy/backup-backend.sh >> /home/deploy/backups/backend-backup.log 2>&1
#
# Uses the SQLite online backup API from inside a throwaway container, so it is safe while
# the backend is running (WAL mode). Keeps the last MAX_BACKUPS files.

set -euo pipefail

VOLUME="${VOLUME:-botargento_backend_data}"
OUT_DIR="${OUT_DIR:-/home/deploy/backups/backend}"
MAX_BACKUPS="${MAX_BACKUPS:-14}"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$OUT_DIR"

docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "${OUT_DIR}:/out" \
  alpine:3.20 sh -c "apk add --no-cache -q sqlite && sqlite3 /data/botargento.db \".backup /out/botargento_${STAMP}.db\""

echo "$(date -Is) backup ok: ${OUT_DIR}/botargento_${STAMP}.db ($(stat -c%s "${OUT_DIR}/botargento_${STAMP}.db") bytes)"

# rotate
ls -1t "${OUT_DIR}"/botargento_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm -f
