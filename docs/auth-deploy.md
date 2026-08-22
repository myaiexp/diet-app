# Auth, deploy, and the database

> Edge SSO, the in-app bearer, CORS, deploy, secrets, and the DB pool. `CLAUDE.md` keeps the map.

## Auth — two independent gates

`diet.mase.fi` is behind an nginx `auth_request` to central-hub
(`127.0.0.1:3200/api/auth/check`), the same gate `prospect`/`st`/`sm` use.
Signing in at `db.mase.fi` authenticates diet too (the session cookie is
`.mase.fi`-scoped), so **there is no login UI in this app and the browser never
holds the API token**. nginx injects `Authorization: Bearer <API_TOKEN>` on
`/api/` *after* the subrequest passes.

In the app, every `/api/*` route except `/api/health` still checks that bearer
itself (`auth.ts`); `API_TOKEN` is required at boot (the server exits if unset,
fail-closed). The two gates are deliberately independent: a misconfigured
`location` block cannot expose the API to anonymous traffic. Health stays public
for the deploy/nginx/uptime checks.

Unit tests omit the token (`createApp(db)` with no config) to exercise route
logic auth-free. Non-browser clients (cron, a future scanner #394) use the
bearer directly — cookie SSO isn't available to them.

Vhost reference copy (token redacted): `docs/nginx-diet.mase.fi.conf`.
HTML locations send a strict CSP (`script-src 'self'`, so only the
content-hashed `/assets/` bundle runs; `style-src`/`font-src` allow
`https://mase.fi` for `base.css` and JetBrains Mono). The shell pins
`base.css` with SRI; a `base.css` change needs a matching integrity hash
in `packages/web/index.html` (see the comment there) and CORS on the apex
`location = /base.css`.

## Unauthenticated responses differ by surface, on purpose

`location /` maps 401 → `302 https://db.mase.fi/login` (a raw 401 page is a dead
end for a browser), while `/api/` keeps answering 401 — the frontend's fetch
client reloads the page on a 401, and following a redirect there would hand it a
login page with status 200. No return URL is passed: central-hub's
`/login?redirect=` takes an in-app path, not a cross-host URL.

## CORS is not involved in the browser path

The app and its API are same-origin (`diet.mase.fi/` and `diet.mase.fi/api/`).
`CORS_ORIGINS` (comma-separated, `config.ts`; unset ⇒ `https://mase.fi` only)
still governs any non-browser or cross-origin client. Never hardcode localhost
in the prod allowlist.

## Public URL and deploy

- **Public URL**: `https://diet.mase.fi` — the app at `/`, its API at `/api/`
  (same origin, proxied to port 3300). The old `mase.fi/diet/api/` path is
  retired: it was a second, edge-unauthenticated door to the same API.
- **Deployment**: Forgejo git hooks (push to deploy) → `diet-app-api.service`
  (systemd, user `mase`). `scripts/post-deploy.sh` then builds `@diet-app/web`
  and rsyncs `packages/web/dist/` → `/var/www/diet.mase.fi/` (mase-owned), so a
  `deploy` ships frontend and API together.
- **Frontend dev**: `pnpm --filter @diet-app/web dev` serves Vite on :5173 and
  proxies `/api` to `API_ORIGIN` (default `127.0.0.1:3300`), injecting
  `Authorization: Bearer $API_TOKEN` — the same header nginx adds in production,
  so dev and prod differ only in who sets it. Point `API_ORIGIN` at a throwaway
  API instance running against `dietapp_test` to browse seeded data without
  touching prod.

## Secrets and env

All secrets live in a gitignored `.env` (`chmod 600`, owned by the run user) —
never committed; `.gitignore` also ignores `.env.*` so editor swaps and
backups (`.env.local`, `.env.save`) stay out of git. `.env.example` holds
placeholders only and is tracked (`!.env.example`). Each Helm worktree keeps
its own gitignored `.env` copy for dev. The nginx vhost also carries
`API_TOKEN` (root-owned, mode 640); rotating the token means updating both.

DB password rotation (superuser `ALTER ROLE` → update `DATABASE_URL` in every
checkout's `.env` → restart service → verify): `docs/db-rotation.md`.

## Database pool

PostgreSQL database is `dietapp`. `createDb`/`createPool`
(`packages/db/src/connection.ts`) apply `POOL_DEFAULTS` — connect 5s, idle 30s,
`statement_timeout` 15s, `query_timeout` 20s (client-side backstop, deliberately
above the server's so the server's cancel wins and releases locks),
`idle_in_transaction_session_timeout` 15s (a stalled cook transaction can't pin
FOR UPDATE locks). Pass overrides as the second arg for a genuinely long job.

`createPool` also attaches the pool's `'error'` listener: node-postgres emits
`'error'` when an *idle* backend dies (`systemctl restart postgresql`,
`pg_terminate_backend`, a dropped tunnel) and Node treats an unhandled
EventEmitter `'error'` as a throw — without it a routine DB restart takes the
API process down. Never construct a bare `new pg.Pool` elsewhere.
