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
- **Deployment**: Forgejo git hooks (push to deploy) → `diet-app-api.service` (systemd, user `mase`)
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS, port 3300)
- **Database**: PostgreSQL `dietapp`
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking
