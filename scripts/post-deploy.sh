#!/usr/bin/env bash
# Build the web frontend and publish it to the diet.mase.fi docroot.
#
# `deploy` runs this from the main checkout after the push has landed and the
# API service has restarted, so the tree here is already at the deployed commit
# (deploy refuses a dirty tree, including untracked files, so what ships always
# traces to a commit).
set -euo pipefail

DOCROOT=/var/www/diet.mase.fi

# The push-to-deploy hook already installs, but a `deploy` that only restarts
# would not have — and a missing vite is a confusing failure three lines later.
# --frozen-lockfile is a fast no-op when nothing changed.
CI=true pnpm install --frozen-lockfile --prefer-offline

pnpm --filter @diet-app/web build

if [[ ! -f packages/web/dist/index.html ]]; then
  echo "✗ web build produced no dist/index.html" >&2
  exit 1
fi

# --delete so a previous build's content-hashed assets don't accumulate in the
# docroot forever. The directory serves this app and nothing else.
rsync -a --delete packages/web/dist/ "$DOCROOT/"

echo "✓ published $(find packages/web/dist -type f | wc -l) files to $DOCROOT"
