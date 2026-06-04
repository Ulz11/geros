#!/usr/bin/env bash
# GerOS restore — bring back a nightly backup made by backup.sh.
# Usage (as root):  bash restore.sh /opt/geros/backups/geros-YYYYMMDD-HHMM.tar.gz
#
# What it does (the same mechanics backend/test/restore.test.mjs drills in CI):
#   1. stop the service
#   2. keep the CURRENT pb_data aside as a safety snapshot (never destroys data)
#   3. unpack the backup's database + uploads into pb_data
#   4. fix ownership, start the service
set -euo pipefail

APP_DIR=/opt/geros
ARCHIVE="${1:-}"
[ -z "$ARCHIVE" ] && { echo "usage: bash restore.sh /opt/geros/backups/geros-YYYYMMDD-HHMM.tar.gz"; exit 1; }
[ -f "$ARCHIVE" ] || { echo "no such file: $ARCHIVE"; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)

echo "==> stopping geros"
systemctl stop geros

echo "==> unpacking $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$WORK"
SNAP_DIR=$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -f "$SNAP_DIR/data.db" ] || { echo "archive has no data.db - not a GerOS backup?"; systemctl start geros; exit 1; }

echo "==> safety snapshot of the CURRENT data -> $APP_DIR/pb_data.before-restore-$STAMP"
[ -d "$APP_DIR/pb_data" ] && mv "$APP_DIR/pb_data" "$APP_DIR/pb_data.before-restore-$STAMP"

echo "==> restoring database + uploads"
mkdir -p "$APP_DIR/pb_data"
cp "$SNAP_DIR/data.db" "$APP_DIR/pb_data/data.db"
[ -f "$SNAP_DIR/auxiliary.db" ] && cp "$SNAP_DIR/auxiliary.db" "$APP_DIR/pb_data/auxiliary.db"
[ -d "$SNAP_DIR/storage" ] && cp -r "$SNAP_DIR/storage" "$APP_DIR/pb_data/storage"

chown -R geros:geros "$APP_DIR/pb_data"
rm -rf "$WORK"

echo "==> starting geros"
systemctl start geros
sleep 2
systemctl --no-pager --quiet is-active geros \
  && echo "RESTORED OK from $ARCHIVE" \
  || { echo "service failed to start - check: journalctl -u geros -n 50"; exit 1; }

echo
echo "The pre-restore data is preserved at $APP_DIR/pb_data.before-restore-$STAMP"
echo "Delete it once you've confirmed everything looks right."
