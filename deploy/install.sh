#!/usr/bin/env bash
# GerOS — one-shot install on a fresh Ubuntu/Debian VPS (e.g. Hetzner CX22).
# Run as root from the repo's deploy/ directory:  bash install.sh yourdomain.mn
set -euo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && { echo "usage: bash install.sh yourdomain.mn"; exit 1; }

APP_DIR=/opt/geros
PB_VERSION="${PB_VERSION:-}"   # leave empty to auto-detect latest

echo "==> packages"
apt-get update -qq
apt-get install -y -qq curl unzip sqlite3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null

echo "==> caddy (TLS + reverse proxy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi

echo "==> pocketbase"
mkdir -p "$APP_DIR"
if [ -z "$PB_VERSION" ]; then
  PB_VERSION=$(curl -s https://api.github.com/repos/pocketbase/pocketbase/releases/latest \
    | grep -oP '"tag_name":\s*"v\K[0-9.]+' | head -1)
fi
echo "    version: $PB_VERSION"
curl -fsSL -o /tmp/pb.zip \
  "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip"
systemctl stop geros 2>/dev/null || true   # idempotent re-runs/upgrades
unzip -oq /tmp/pb.zip -d "$APP_DIR"
chmod +x "$APP_DIR/pocketbase"

echo "==> app files (hooks + migrations + public site + admin app)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -r "$SCRIPT_DIR/../backend/pb_hooks"      "$APP_DIR/"
cp -r "$SCRIPT_DIR/../backend/pb_migrations" "$APP_DIR/"   # self-provisioning: builds the DB on first serve
cp -r "$SCRIPT_DIR/../backend/pb_public"     "$APP_DIR/"

echo "==> system user + permissions"
id -u geros >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin geros
chown -R geros:geros "$APP_DIR"

# Optional unattended superuser. Set SUPERUSER_EMAIL to provision one now; a
# strong password is generated and printed ONCE (never stored in the repo). Skip
# this and create the first superuser via the web UI at https://DOMAIN/_/ instead.
SU_CREATED=""
if [ -n "${SUPERUSER_EMAIL:-}" ]; then
  SU_PASS="${SUPERUSER_PASS:-$(openssl rand -base64 18)}"
  echo "==> superuser ($SUPERUSER_EMAIL)"
  sudo -u geros "$APP_DIR/pocketbase" superuser upsert "$SUPERUSER_EMAIL" "$SU_PASS" --dir "$APP_DIR/pb_data"
  chown -R geros:geros "$APP_DIR/pb_data"
  SU_CREATED="yes"
fi

echo "==> systemd"
cp "$SCRIPT_DIR/geros.service" /etc/systemd/system/geros.service
systemctl daemon-reload
systemctl enable --now geros   # serve auto-applies pb_migrations -> collections + users fields ready

echo "==> caddy vhost"
sed "s/YOUR_DOMAIN/$DOMAIN/" "$SCRIPT_DIR/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy

echo "==> nightly backup"
cp "$SCRIPT_DIR/backup.sh"  "$APP_DIR/backup.sh"  && chmod +x "$APP_DIR/backup.sh"
cp "$SCRIPT_DIR/restore.sh" "$APP_DIR/restore.sh" && chmod +x "$APP_DIR/restore.sh"
( crontab -l 2>/dev/null | grep -v geros/backup.sh || true ; echo "20 3 * * * $APP_DIR/backup.sh >/var/log/geros-backup.log 2>&1" ) | crontab -

echo
echo "DONE. The database, collections and users fields are provisioned automatically"
echo "by pb_migrations on first start - no manual schema import."
echo
echo "Next steps:"
echo "  1. Point $DOMAIN's A record at this server."
if [ -n "$SU_CREATED" ]; then
  echo "  2. Superuser ready: $SUPERUSER_EMAIL"
  if [ -z "${SUPERUSER_PASS:-}" ]; then
    echo "     PASSWORD (shown once, store it now): $SU_PASS"
  fi
else
  echo "  2. Open https://$DOMAIN/_/ and create the first superuser."
fi
echo "  3. In https://$DOMAIN/_/ create the 5 staff accounts (users collection already"
echo "     has the full_name + role fields). Roles: admin / manager / kitchen / worker."
echo "  4. Site: https://$DOMAIN   Staff app: https://$DOMAIN/admin/"
