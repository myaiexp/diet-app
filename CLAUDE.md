# Diet App

> AI-driven meal planning app with pantry tracking, shopping lists, and nutrition management.

## Key Patterns

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps
- **API**: Each route module exports `(db: Db) => Hono`, mounted in app.ts
- **Drizzle API choice** (one rule, applied across all route files): use the relational API `db.query.X.findFirst/findMany()` **only** when you need `with:` eager-loading of relations (e.g. recipes `:id` → `recipeIngredients`). For everything else — plain lists, raw-SQL filters (`ilike`, `unnest`, `@>`), and pagination — use the core builder `db.select().from().where()`. The two APIs aren't interchangeable (only the relational one does `with:`), so let that need drive the choice rather than habit.
- **List filtering**: build a `conditions` array, then pass `conditions.length ? and(...conditions) : undefined` to a single `.where()` — Drizzle treats `undefined` as no clause, so never fork into a separate unfiltered query.
- **List pagination**: unbounded list endpoints take `?limit`/`?offset` via `getPagination(c)` (`pagination.ts`) — default 50, clamped to ≤200. Bounded endpoints (e.g. meal-plans by week) don't paginate.
- **`/:id` routes** validate the param with `isUuid(id)` (`validation.ts`) and return `400 {error:'Invalid id format'}` before querying, so a malformed id never reaches Postgres as an unhandled `invalid input syntax for type uuid`.
- **Deployment**: Forgejo git hooks (push to deploy) → `diet-app-api.service` (systemd, user `mase`)
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS, port 3300)
- **Database**: PostgreSQL `dietapp`
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking
