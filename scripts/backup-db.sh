#!/usr/bin/env bash
# ===========================================
# BotArgento — SQLite Database Backup Script
# ===========================================
#
# Usage:
#   Local:   ./scripts/backup-db.sh
#   Railway: railway run ./scripts/backup-db.sh
#
# Creates a timestamped copy of the SQLite database file.
# Safe to run while the server is running (uses SQLite .backup API via CLI).
#
# Options:
#   BACKUP_DIR   — Target directory for backups (default: ./backups)
#   DATABASE_PATH — Source database path (default: from .env or /data/botargento.db)
#   MAX_BACKUPS  — Number of backups to retain (default: 10, 0 = keep all)

set -euo pipefail

# --- Configuration ---
DB_PATH="${DATABASE_PATH:-/data/botargento.db}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
MAX_BACKUPS="${MAX_BACKUPS:-10}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/botargento_${TIMESTAMP}.db"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# --- Preflight checks ---
if [ ! -f "$DB_PATH" ]; then
  error "Database file not found: $DB_PATH"
  error "Set DATABASE_PATH env var or check that the database exists."
  exit 1
fi

# Check if sqlite3 CLI is available
if ! command -v sqlite3 &> /dev/null; then
  warn "sqlite3 CLI not found. Falling back to file copy."
  warn "For a fully consistent backup, install sqlite3."
  USE_SQLITE3=false
else
  USE_SQLITE3=true
fi

# --- Create backup directory ---
mkdir -p "$BACKUP_DIR"

# --- Perform backup ---
info "Starting backup..."
info "  Source:  $DB_PATH"
info "  Target:  $BACKUP_FILE"

if [ "$USE_SQLITE3" = true ]; then
  # Use SQLite .backup command for a consistent snapshot
  # This is safe even if the database is being written to (WAL mode)
  sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"
else
  # Fallback: simple file copy
  # Safe with WAL mode as long as we also copy WAL/SHM files
  cp "$DB_PATH" "$BACKUP_FILE"
  [ -f "${DB_PATH}-wal" ] && cp "${DB_PATH}-wal" "${BACKUP_FILE}-wal"
  [ -f "${DB_PATH}-shm" ] && cp "${DB_PATH}-shm" "${BACKUP_FILE}-shm"
fi

# --- Verify backup ---
BACKUP_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo "unknown")
if [ "$BACKUP_SIZE" = "unknown" ] || [ "$BACKUP_SIZE" -eq 0 ]; then
  error "Backup file is empty or could not determine size."
  exit 1
fi

info "Backup complete: $BACKUP_FILE ($BACKUP_SIZE bytes)"

# --- Rotate old backups ---
if [ "$MAX_BACKUPS" -gt 0 ]; then
  BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/botargento_*.db 2>/dev/null | wc -l | tr -d ' ')
  if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
    EXCESS=$((BACKUP_COUNT - MAX_BACKUPS))
    info "Rotating: removing $EXCESS old backup(s) (keeping $MAX_BACKUPS)"
    ls -1t "$BACKUP_DIR"/botargento_*.db | tail -n "$EXCESS" | while read -r old; do
      rm -f "$old" "${old}-wal" "${old}-shm"
      info "  Removed: $(basename "$old")"
    done
  fi
fi

info "Done."
