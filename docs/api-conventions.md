# API conventions

> How routes are shaped, queried, and answered. `CLAUDE.md` keeps the map.

## Route modules

Each route module exports a named function `routeName(db: Db): Hono` (e.g.
`recipesRoutes`, `pantryRoutes`), mounted in `app.ts` via `createApp(db, config)`.

## Drizzle API choice

One rule, applied across all route files: use the relational API
`db.query.X.findFirst/findMany()` **only** when you need `with:` eager-loading of
relations (recipes `:id` → `recipeIngredients`; every pantry read →
`ingredient`). For everything else — plain lists, raw-SQL filters (`ilike`,
`unnest`, `@>`), and pagination — use the core builder
`db.select().from().where()`. The two APIs aren't interchangeable (only the
relational one does `with:`), so let that need drive the choice rather than
habit.

## Pantry responses always carry `ingredient`

A row stores only an `ingredientId` and every consumer needs the
name/alias/category, so all four endpoints answer with the relation attached:
the two reads via `with: { ingredient: true }`, POST by reusing the ingredient
it already loaded for the shelf-life check, PATCH by putting `with:` on its
pre-check read (PATCH can't change `ingredientId`, so that row is still the
right one). Without it a 50-row page costs 50 follow-up requests — a cost that
grows with the pantry, which is why it belongs in the query and not in the
client.

## List filtering, pagination, ordering

- **Filtering**: build a `conditions` array, then pass
  `conditions.length ? and(...conditions) : undefined` to a single `.where()` —
  Drizzle treats `undefined` as no clause, so never fork into a separate
  unfiltered query.
- **Pagination**: unbounded list endpoints take `?limit`/`?offset` via
  `getPagination(c)` (`pagination.ts`) — default 50, clamped to ≤200. Bounded
  endpoints (e.g. meal-plans by week) don't paginate.
- **Ordering**: every list query ends `.orderBy(<sort column>, asc(<table>.id))`
  before `.limit()/.offset()` — the id tie-break is mandatory, not decoration.
  Postgres guarantees no order without `ORDER BY`, and a non-unique sort key is
  no better: a plan switch, a concurrent `PATCH` rewriting a row, or an
  autovacuum pass is enough for a client walking `?offset=0,50,100…` to get one
  row twice and never see another. Current orders: ingredients `name`, recipes
  `createdAt desc`, pantry `expiresDate` (spoilage-first), meal-plan week
  `date`, shopping lists `weekStarting desc`. Bounded endpoints order too —
  they can't skip rows, but two GETs must not return the same set in different
  orders. Slot order is deliberately not a sort key: `slot` as text reads
  breakfast/dinner/lunch/snack, so the client sorts it. Mock suites assert the
  exact columns via `calls.orderBy` (`chainSelect`) — or, for a relational list
  like pantry's, via the args object handed to `findMany` (`makeListMock` in
  pantry.test.ts).

## `/:id` routes

Validate the param with `isUuid(id)` (`validation.ts`) and return
`400 {error:'Invalid id format'}` before querying, so a malformed id never
reaches Postgres as an unhandled `invalid input syntax for type uuid`.

## Shared responses and write bodies

- **Shared responses**: `notFound` / `badRequest` / `unauthorized` / `conflict`
  / `payloadTooLarge` / `badGateway` / `serviceUnavailable` in `responses.ts`.
  Don't re-inline error shapes — every `{ error }` body in the API goes through
  one of these, so a later envelope change (adding a `code` field) lands once
  instead of missing whichever handlers drifted.
- **Write bodies**: `parseJsonBody(c, schema, { requireNonEmpty })`
  (`json-body.ts`) folds the JSON read, the Zod `safeParse`, and the
  `Invalid JSON body` / `Validation failed` / `Empty patch body` 400s into one
  call — `const parsed = await parseJsonBody(...); if (!parsed.ok) return parsed.response;`.
  Routes never re-inline those shapes and never import `z`. Schemas live under
  `schemas/`. Free-text, array, and URL fields share caps in
  `schemas/fields.ts` (title 200, notes 4k, steps 80×4k, http(s) URLs 2048);
  `sourceUrl` / import `url` reject non-http(s). `macroTargets` /
  `scheduleProfile` are small known-key objects, not `z.unknown()` records.
  The router also mounts Hono `bodyLimit` at 1 MiB (`MAX_BODY_BYTES` in
  `app.ts`) *before* CORS/auth, so a loopback client that bypasses nginx's 2M
  cannot make `c.req.json()` buffer an arbitrary body; oversize is 413 via
  `payloadTooLarge`.
- **PATCH payloads**: build the `.set()` object with `buildPatch(data, table, omit?)`
  (`patch-builder.ts`), typed `Partial<typeof table.$inferInsert>` so Drizzle
  still type-checks the write. It copies every defined patch field naming a
  column of `table`, so a field added to a Zod patch schema is written
  automatically instead of silently dropped. Fields that aren't columns
  (`ingredients`, `dislikedIngredientIds`) are skipped for the route to handle;
  numeric columns whose Zod type is `number` (`servings`, `quantity`) go in
  `omit` and get an explicit `String(...)` line after the spread.

## Recipe import

- **AI config**: optional `parseAiConfig` (`AI_API_KEY` + `AI_BASE_URL` +
  `AI_MODEL_CAPABLE`); missing any → `null` and `POST /recipes/import` returns
  503. Never required at boot.
- **Recipe import**: draft-only (`POST /api/recipes/import`); never inserts —
  client confirms via `POST /recipes`. SSRF-safe URL fetch in `ai/fetch-url.ts`
  (hostname/DNS blocklist, ports 80/443 only, TCP connect pinned to the
  already-allowed DNS answers so undici cannot re-resolve at connect time);
  extract in `ai/import-recipe.ts`; exact catalog match in `ingredient-match.ts`.
- **Import failure logging**: the import chain talks to two unreliable external
  services and collapses every failure into an opaque sentinel (`{ok:false}` /
  `fetch_failed`) behind a flat 502, so **every discarding site logs its cause
  first** via `logImportFailure(stage, detail?, context?)` (`ai/log.ts`) —
  journalctl is the only diagnostic channel and Hono's `onError` never sees a
  caught error. Responses stay opaque on purpose; no cause detail leaks to the
  client. `describeError` unwraps `err.cause` because undici reports *every*
  transport failure as `TypeError: fetch failed` and the OpenAI SDK as
  `Error: Connection error.` — the real reason (ENOTFOUND, ECONNREFUSED,
  status=401) lives only in `cause`. Expected user-input rejections (a bad or
  blocked URL the client typed) stay unlogged; a *redirect* target rejection
  logs, since there the user's own URL was fine. Elsewhere in the API, route
  `catch (err)` blocks `throw err` after mapping known PG codes, so unknown
  errors still reach `onError` — don't add a bare `catch {}` that breaks that.

## Postgres errors

`isFkViolation` / `isUniqueViolation` in `pg-errors.ts` — use for 23503/23505;
don't re-inline the code checks. Both **walk the `cause` chain**, because
Drizzle wraps every driver error in a `DrizzleQueryError` that carries the real
one on `.cause` and has no `code` of its own. A one-level check therefore
returns false for every *live* violation while staying green in the mock suites,
which throw an unwrapped driver error — that is precisely how five route
modules' 400/409 mapping sat broken and covered at the same time until the
shopping-list integration round trip hit a real duplicate. Never reintroduce a
shallow `'code' in err` check.
