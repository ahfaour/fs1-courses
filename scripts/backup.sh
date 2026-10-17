#!/usr/bin/env bash
# Dated backup of the database (online, safe while the app runs) and the uploads folder.
# Keeps the newest 14 of each.
#   scripts/backup.sh [DATA_DIR] [BACKUP_DIR]
# Cron, every night at 02:30:
#   30 2 * * * cd /srv/fs1-courses && scripts/backup.sh ./data /var/backups/fs1 >> /var/log/fs1-backup.log 2>&1
set -euo pipefail

DATA_DIR="${1:-./data}"
BACKUP_DIR="${2:-./backups}"
KEEP=14
STAMP="$(date -u +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

sqlite3 "$DATA_DIR/site.db" ".backup '$BACKUP_DIR/site-$STAMP.db'"
tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$DATA_DIR" uploads

# Prune: keep the newest $KEEP of each kind.
ls -1t "$BACKUP_DIR"/site-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f --
ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f --

echo "$(date -u +%FT%TZ) backup ok: site-$STAMP.db, uploads-$STAMP.tar.gz"
