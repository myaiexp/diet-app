#!/usr/bin/env bash
set -euo pipefail

# Deploy diet-app to /opt/diet-app on VPS
# System service: diet-app-api.service (runs as www-data)
DEPLOY_DIR="/opt/diet-app"

echo "==> Building packages..."
npm run -w packages/db build
npm run -w packages/api build

echo "==> Syncing to $DEPLOY_DIR..."
sudo rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.claude' \
  --exclude='.env' \
  --exclude='service.log' \
  ./ "$DEPLOY_DIR/"

echo "==> Installing production dependencies..."
cd "$DEPLOY_DIR"
sudo npm install --omit=dev

echo "==> Fixing ownership..."
sudo chown -R www-data:www-data "$DEPLOY_DIR"

echo "==> Running database migrations..."
# Load DATABASE_URL without sourcing .env: `source` would execute any shell
# metacharacters in a value (a password containing $(...), backticks, or ';'
# would run as code). grep|cut captures the value as a literal string and
# command substitution never re-interprets it, so exporting it is injection-safe.
sudo -u www-data bash -c '
  cd "$1" || exit 1
  DATABASE_URL=$(grep -E "^DATABASE_URL=" .env | head -n1 | cut -d= -f2-)
  export DATABASE_URL
  npx -w packages/db drizzle-kit migrate
' _ "$DEPLOY_DIR" 2>/dev/null || true

echo "==> Restarting service..."
sudo systemctl restart diet-app-api.service

echo "==> Waiting for startup..."
sleep 2

if curl -sf http://127.0.0.1:3300/api/health | grep -q '"ok":true'; then
  echo "==> Deploy successful! Health check passed."
else
  echo "==> WARNING: Health check failed!"
  sudo systemctl status diet-app-api.service --no-pager
  exit 1
fi
