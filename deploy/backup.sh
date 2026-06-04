#!/usr/bin/env bash
# GerOS nightly backup — consistent SQLite snapshot + uploaded files.
# Installed to /opt/geros/backup.sh by install.sh; cron runs it at 03:20.
# Restore: stop geros, copy the snapshot back over pb_data/, start geros.
set -euo pipefail

APP_DIR=/opt/geros
BK_DIR=/opt/geros/backups
KEEP=14
STAMP=$(date +%Y%m%d-%H%M)

mkdir -p "$BK_DIR/$STAMP"

# 1. consistent copy of the live database (sqlite online backup API — safe
#    while PocketBase is running, unlike a plain cp/tar of data.db)
sqlite3 "$APP_DIR/pb_data/data.db" ".backup '$BK_DIR/$STAMP/data.db'"
[ -f "$APP_DIR/pb_data/auxiliary.db" ] && \
  sqlite3 "$APP_DIR/pb_data/auxiliary.db" ".backup '$BK_DIR/$STAMP/auxiliary.db'" || true

# 2. uploaded files (operator PDFs, invoices, site images)
[ -d "$APP_DIR/pb_data/storage" ] && cp -r "$APP_DIR/pb_data/storage" "$BK_DIR/$STAMP/storage" || true

# 3. compress + rotate
tar -czf "$BK_DIR/geros-$STAMP.tar.gz" -C "$BK_DIR" "$STAMP"
rm -rf "$BK_DIR/$STAMP"
ls -1t "$BK_DIR"/geros-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f

echo "backup ok: geros-$STAMP.tar.gz ($(du -h "$BK_DIR/geros-$STAMP.tar.gz" | cut -f1))"
