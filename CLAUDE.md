# Diet App

> AI-driven meal planning app with pantry tracking, shopping lists, and nutrition management.

## Key Patterns

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps
- **API**: Each route module exports a named function `routeName(db: Db): Hono` (e.g. `recipesRoutes`, `pantryRoutes`), mounted in app.ts via `createApp(db, config)`
- **Auth**: every `/api/*` route except `/api/health` requires `Authorization: Bearer <API_TOKEN>` (shared secret, single-user app — `auth.ts`). `API_TOKEN` is a required env var: the server exits on startup if it's unset (fail-closed). Health stays public for the deploy/nginx/uptime checks. Unit tests omit the token (`createApp(db)` with no config) to exercise route logic auth-free.
- **CORS**: origins are env-driven via `CORS_ORIGINS` (comma-separated, parsed in `config.ts`). Unset ⇒ production-safe default `https://mase.fi` only; dev sets `CORS_ORIGINS=https://mase.fi,http://localhost:5173`. Never hardcode localhost in the prod allowlist.
- **Drizzle API choice** (one rule, applied across all route files): use the relational API `db.query.X.findFirst/findMany()` **only** when you need `with:` eager-loading of relations (e.g. recipes `:id` → `recipeIngredients`). For everything else — plain lists, raw-SQL filters (`ilike`, `unnest`, `@>`), and pagination — use the core builder `db.select().from().where()`. The two APIs aren't interchangeable (only the relational one does `with:`), so let that need drive the choice rather than habit.
- **List filtering**: build a `conditions` array, then pass `conditions.length ? and(...conditions) : undefined` to a single `.where()` — Drizzle treats `undefined` as no clause, so never fork into a separate unfiltered query.
- **List pagination**: unbounded list endpoints take `?limit`/`?offset` via `getPagination(c)` (`pagination.ts`) — default 50, clamped to ≤200. Bounded endpoints (e.g. meal-plans by week) don't paginate.
- **`/:id` routes** validate the param with `isUuid(id)` (`validation.ts`) and return `400 {error:'Invalid id format'}` before querying, so a malformed id never reaches Postgres as an unhandled `invalid input syntax for type uuid`.
- **Shared responses**: GET-by-id misses return `notFound(c)` from `responses.ts` (`{error:'Not found'}`, 404) — don't re-inline the body. Any future change to the error shape lands in that one helper.
- **Deployment**: Forgejo git hooks (push to deploy) → `diet-app-api.service` (systemd, user `mase`)
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS, port 3300)
- **Database**: PostgreSQL `dietapp`
- **Secrets & env loading**: all secrets live in a gitignored `.env` (`chmod 600`, owned by the run user) — never committed; `.env.example` holds placeholders only. `load-env.ts` loads the repo-root `.env` resolved **relative to its own module file** (not the CWD): `src/` (dev/tsx) and `dist/` (prod/node) sit at the same depth under `packages/api`, so `../../../.env` reaches the repo root from either. Prod's systemd `WorkingDirectory` is `/opt/diet-app` and its `.env` there is managed on the box (excluded from the deploy rsync). To rotate the DB password: `ALTER ROLE dietapp PASSWORD '<new>'`, then update `DATABASE_URL` in both `/opt/diet-app/.env` and the dev `.env`, and restart `diet-app-api.service`.
- **Dependency overrides** (root `package.json`): `drizzle-kit` still declares the deprecated `@esbuild-kit/esm-loader` (predecessor of tsx) in its `dependencies` but never imports it — at runtime it loads `drizzle.config.ts` via `tsx/cjs/api`. A nested override (`overrides.drizzle-kit['@esbuild-kit/esm-loader']: "npm:tsx@^4"`) aliases that dead declaration to the tsx we already depend on, which drops `@esbuild-kit/{esm-loader,core-utils}` and the stale `esbuild@0.18.20` chain they pulled in (~56 fewer lockfile entries). The flat (top-level) override form is silently ignored by npm 10 for this deep transitive — it must be scoped under `drizzle-kit`. Remove the override once drizzle-kit (>0.31.10) drops the vestigial dep.
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking

## Plans

- **Active design docs**: `docs/plans/` — `2026-03-05-project-init-design.md` (authoritative architecture) and `2026-03-05-phase0-skeleton.md` (Phase 0 implementation plan).
- **Archived**: `docs/plans/archived/` — pre-implementation synthesized brainstorming. Historical only; some assumes a stack that was never adopted (Next.js/Vercel/Supabase). See its `README.md`.
