# Diet App

> AI-driven meal planning app with pantry tracking, shopping lists, and nutrition management.

This file is a **map**, not a manual. Standing rules live in `docs/`; design
rationale lives in `docs/plans/`. Summarize and point — if a bullet would need a
paragraph of "why", the why belongs in the linked subdoc.

## Stack

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps.
- **Workspaces**: `packages/db` (Drizzle schema + connection), `packages/api`
  (Hono, port 3300), `packages/web` (Vite + vanilla TS, no framework; screens
  grouped by feature under `src/screens/<feature>/` (index.ts is the Screen
  factory; profile stays a single file at the top of `screens/`); modals in
  `src/modals/` next to the cook flow; one thin API module per resource
  under `src/api/`, `base.css` from mase.fi). Screen loads go through
  `loadInto` (`packages/web/src/ui/async.ts`) and `ctx.isStale()` from the
  router — never a module-local `destroyed` flag.
- **Web client**: paginated collections drain through `fetchAllPages`
  (`listAllRecipes` / `listAllPantry`) at the API max page (200); every fetch
  uses `AbortSignal.timeout` (25s, 45s for recipe import).
- **Public URL**: `https://diet.mase.fi` — the app at `/`, its API at `/api/`
  (same origin). Auth (two independent gates), CORS, deploy, secrets, and the
  DB pool: **`docs/auth-deploy.md`**. Password rotation: `docs/db-rotation.md`.
  Vhost reference (token redacted): `docs/nginx-diet.mase.fi.conf`.
- **Database**: PostgreSQL `dietapp` — one database, and every worktree's `.env`
  points at it. Schema changes: `pnpm --filter @diet-app/db generate` then
  `migrate` — never `push` (it prompts and hangs without a TTY). `migrate` runs
  through a guard that refuses **destructive** pending DDL from a worktree and
  sends it to the deploy's own migrate step instead; additive DDL applies
  normally. Test DB: `pnpm --filter @diet-app/db setup:test-db`.
  Details: **`docs/testing.md`**.
- Core concepts: spoilage-first pantry, AI meal planning, constraint
  satisfaction, auto-deduct cooking.

## API

- Route modules export `routeName(db: Db): Hono`, mounted via `createApp`.
  Drizzle `with:` vs core builder, pantry-always-joins-ingredient, list
  filter/page/order (id tie-break), shared 4xx helpers, JSON/PATCH, recipe
  import logging, and walking the PG `cause` chain: **`docs/api-conventions.md`**.
- **Recipe scaling**: scaled views are `GET /recipes/:id?servings=N`
  (`recipe-scale.ts`); the client must not reimplement `qty × target / base`.
  Design: `docs/plans/2026-07-21-phase1-closeout-design.md`.
- **Recipe fork**: `POST /recipes/:id/fork` copies content, not history —
  `userRating`/`timesCooked` stay behind, `parentRecipeId` is the immediate
  source. Optional strict `{ title }` body. Rules: **`docs/api-conventions.md`**.
- **Cook flow**: confirm loads `GET /meal-plans/:id/cook-preview` (read-only);
  `cooked` is terminal via `POST /meal-plans/:id/cook`, whose optional
  `{ servings }` body scales the deduction and lands in `actual_servings`,
  leaving `servings` as the planned figure; PATCH cannot change the
  inputs the deduction was computed from. Feedback invariant (`changesNote`
  iff `usedAsIs` is false) is resolved once by `mergeFeedback` and checked once
  by `feedbackPairError`. Rules:
  **`docs/cook-flow.md`**. Design: `docs/plans/2026-07-20-cook-flow-design.md`.
- **Shopping lists**: generate merges, never rebuilds; netting is a per-day
  FEFO simulation (`quantityInPantry` = demand covered, not stock on hand);
  `done` is terminal via `/complete`. Rules: **`docs/shopping-lists.md`**.
  Design: `docs/plans/2026-08-04-shopping-lists-design.md`.
- **Grocery products** are SKUs, not ingredient concepts — do not merge the
  tables or overwrite `ingredients.nutritionPer100g` from a product. Schema,
  `(store_id, ean)` key, importer: `docs/plans/2026-08-05-grocery-products-design.md`.
  S-kaupat API, Jämsä store id (`660919473`), nutrient parsing:
  `docs/s-kaupat-api.md`.

## Testing and type-check

api/db emit and exclude tests from `dist` (`tsconfig.typecheck.json` covers
them); web type-checks tests via its main no-emit `tsconfig.json`. One vitest
entry at the repo root. Tests and type-check resolve `@diet-app/db` from
source, so a fresh clone or worktree needs no build; root `pnpm build`
(`pnpm -r build`, dependency-ordered) is for the api's Node-resolved paths —
`build`, `start`, `dev`. Real-SQL suites (22 cases in `routes.test.ts`, 4 in
`import-products-sql.test.ts`) share the loud `TEST_DATABASE_URL` /
`DIET_APP_SKIP_DB_TESTS` gate, and hold one advisory lock
(`packages/db/src/test-lock.ts`) so concurrent worktree sessions can't corrupt
each other's fixtures in the single `dietapp_test`. Mocks, fixture-by-table
(never call-order), demo seed, drizzle-kit override, schema-migration workflow:
**`docs/testing.md`**.

## Plans

Active design docs in `docs/plans/`:

- `2026-03-05-project-init-design.md` — original 2026-03-05 architecture
  (superseded on URL/auth/frontend; current stack is Stack/API above,
  `docs/auth-deploy.md`, and later shipped plans)
- `2026-03-05-phase0-skeleton.md` — Phase 0
- `2026-07-20-pantry-recipe-writes-design.md` + `-plan.md` — Phase 1 pantry/recipe
  write endpoints, shipped
- `2026-07-20-cook-flow-design.md` + `-plan.md` — meal plan writes, auto-deduct
  on cook, cook feedback (#379/#241/#377), shipped
- `2026-07-21-phase1-closeout-design.md` + `-plan.md` — profile writes #376,
  recipe scaling #240, recipe import draft #378, shipped
- `2026-08-04-shopping-lists-design.md` + `-plan.md` — list generation from the
  meal plan #381, item/status writes and the `/complete` pantry hand-off #382,
  shipped
- `2026-08-04-frontend-design.md` + `2026-08-04-frontend-phase1-plan.md` — the
  frontend #391, **shipped** (including shopping list #3238/#3233). Placeholders
  remain for AI suggestions (#380), nutrition (#385), and waste (#389) — no
  endpoint yet.
- `2026-08-05-grocery-products-design.md` — products table and S-market Jämsä
  import, shipped

**Frontend design doc caveat**: `2026-08-04-frontend-design.md` is authoritative
for look, layout, copy and interaction, but **not for the API** — the design
tool invented endpoint names. Its provenance header lists the corrections; read
that header before trusting any path in it. The companion prototype
(`docs/plans/assets/ruoka-prototype.dc.html`) does not render in a browser (it
needs the design tool's template runtime) — it is kept for its mock-data arrays,
which are the intended seed fixtures.

**Archived**: `docs/plans/archived/` — pre-implementation synthesized
brainstorming. Historical only; some assumes a stack that was never adopted
(Next.js/Vercel/Supabase). See its `README.md`.

**Review-pattern memory**: `docs/review-patterns.json` is grok execute-loop
skill memory (`{pattern, count, lastSeen}`), not a living subdoc. The skill
injects only `count ≥ 2` patterns.
