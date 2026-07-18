#!/usr/bin/env bash
# Provision dietapp_test: create DB, migrate, seed, grant app role.
# Idempotent — safe to re-run after schema changes or a dropped test DB.
#
# Usage (from repo root or packages/db):
#   pnpm --filter @diet-app/db setup:test-db
#   # or: bash packages/db/scripts/setup-test-db.sh
#
# Override the target with TEST_DATABASE_URL (must end with _test).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PKG="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DB_PKG/../.." && pwd)"

# Default matches .env.example — peer auth as mase on the local socket.
DEFAULT_TEST_URL='postgresql://mase@/dietapp_test?host=/var/run/postgresql'
TEST_URL="${TEST_DATABASE_URL:-$DEFAULT_TEST_URL}"

# App role that owns prod connections; tables are often created by mase (peer
# auth) so dietapp needs explicit DML grants or every query 500s.
APP_ROLE="${DIETAPP_APP_ROLE:-dietapp}"
if [[ ! "$APP_ROLE" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "error: DIETAPP_APP_ROLE must be a plain identifier (got: '$APP_ROLE')" >&2
  exit 1
fi

# --- Safety: never touch prod -------------------------------------------------
# Extract the database name from a postgres URL (path after host, strip query).
db_name_from_url() {
  local url="$1"
  # postgresql://user:pass@host:port/dbname?params  OR  postgresql://user@/dbname?host=...
  local path
  path="${url#*://}"
  path="${path#*/}"          # drop authority
  path="${path%%\?*}"        # drop query
  path="${path%%/*}"         # drop any trailing path segments
  printf '%s' "$path"
}

DB_NAME="$(db_name_from_url "$TEST_URL")"
if [[ -z "$DB_NAME" || "$DB_NAME" != *_test ]]; then
  echo "error: refusing to provision — database name must end in '_test' (got: '${DB_NAME:-<empty>}')" >&2
  echo "  TEST_DATABASE_URL=$TEST_URL" >&2
  exit 1
fi
if [[ ! "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "error: database name must be a plain identifier (got: '$DB_NAME')" >&2
  exit 1
fi

echo "==> Target database: $DB_NAME"
echo "==> URL: ${TEST_URL//:*@/:***@}"

# --- Create DB if missing -----------------------------------------------------
if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  echo "==> Creating database $DB_NAME..."
  createdb "$DB_NAME"
else
  echo "==> Database $DB_NAME already exists"
fi

# --- Migrate + seed (DATABASE_URL wins over dotenv-loaded .env) ---------------
export DATABASE_URL="$TEST_URL"
cd "$DB_PKG"

echo "==> Migrating..."
pnpm exec drizzle-kit migrate

echo "==> Seeding ingredients + default profile..."
pnpm exec tsx src/seed.ts

# --- Grants for the app role (tables owned by mase after peer-auth migrate) ---
echo "==> Granting $APP_ROLE on schema public..."
psql -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
SQL

echo "==> Done. Point TEST_DATABASE_URL at this DB and run: pnpm --filter @diet-app/api test"
echo "    export TEST_DATABASE_URL='$TEST_URL'"
