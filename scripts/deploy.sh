#!/usr/bin/env bash
set -euo pipefail

REMOTE="vps"
REMOTE_DIR="/opt/diet-app"
API_PORT=3300

echo "=== Building packages ==="
cd "$(git rev-parse --show-toplevel)"
(cd packages/db && npm run build)
(cd packages/api && npm run build)

echo "=== Syncing to VPS ==="
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='*.ts' \
  --exclude='*.tsbuildinfo' \
  package.json package-lock.json tsconfig.base.json \
  "$REMOTE:$REMOTE_DIR/"

rsync -az --delete \
  --exclude='node_modules' \
  --exclude='src' \
  --exclude='*.ts' \
  --exclude='*.tsbuildinfo' \
  packages/ "$REMOTE:$REMOTE_DIR/packages/"

# Sync data directory (ingredients.json etc) — these are needed at runtime
rsync -az packages/db/data/ "$REMOTE:$REMOTE_DIR/packages/db/data/" 2>/dev/null || true

# Sync drizzle migrations
rsync -az packages/db/drizzle/ "$REMOTE:$REMOTE_DIR/packages/db/drizzle/"

echo "=== Installing dependencies on VPS ==="
ssh "$REMOTE" "cd $REMOTE_DIR && npm install --omit=dev"

echo "=== Running migrations (local via SSH tunnel) ==="
# Migrations run locally through SSH tunnel to avoid needing tsx on VPS
# Ensure tunnel is running: npm run dev:tunnel
(cd packages/db && npm run migrate)

echo "=== Restarting service ==="
ssh "$REMOTE" "sudo systemctl restart diet-app-api"

sleep 2

echo "=== Verifying ==="
HEALTH=$(ssh "$REMOTE" "curl -s localhost:$API_PORT/api/health")
echo "Health check: $HEALTH"

if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "=== Deploy successful ==="
else
  echo "=== Deploy FAILED — health check did not return ok ==="
  exit 1
fi
