#!/usr/bin/env bash
# Deploy health gate probe: is the restarted API up and reaching Postgres?
#
#   healthcheck.sh [EXPECTED_SHA | --sha]
#
# helm's `deploy` (deploy-lib/rollback.sh, run_health_gate) polls this after it
# restarts diet-app-api and forward-reverts the deploy when it never exits 0.
# The gate runs before scripts/post-deploy.sh, so it covers the API build, boot
# and the DB pool — not the frontend publish or the catalog seed, whose
# failures fail the deploy from post-deploy.sh instead.
#
# Exit codes (the gate keys on these):
#   0  healthy: HTTP 200 and { ok: true }
#   1  down, unreachable, 503 (Postgres does not answer) or not ok
#
# /api/health reports no served sha, so an EXPECTED_SHA argument is accepted
# (probe_health always passes one) and ignored, and `--sha` has nothing to
# print: the gate answers "is the API back up", not "is it serving this
# commit", and its sha-drift branch can never fire for this project.
#
# DIET_APP_HEALTH_URL overrides the URL for tests; 3300 is the port index.ts binds.
set -uo pipefail

URL="${DIET_APP_HEALTH_URL:-http://127.0.0.1:3300/api/health}"

# -f: /api/health answers 503 when Postgres does not, which must count as down.
resp=$(curl -fsS -m 5 "$URL" 2>/dev/null) || exit 1

[ "${1:-}" = "--sha" ] && exit 0

jq -e '.ok == true' >/dev/null 2>&1 <<< "$resp" || exit 1
exit 0
