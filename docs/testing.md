# Testing and type-check

> How the suite is built, typed, and gated. `CLAUDE.md` keeps the map.

## Build vs type-check

**api and db emit.** Each of those packages' `tsconfig.json` excludes
`src/__tests__` so tests never land in `dist` (vitest 4 dropped `**/dist/**`
from its default exclude, so an emitted copy would run as a second, stale
suite — each package's `vitest.config.ts` re-adds that exclusion as the
belt-and-braces half). Consequence: `tsc --noEmit` on the build config skips
tests — type-check with `pnpm --filter @diet-app/{api,db} typecheck`
(`tsconfig.typecheck.json`, all of `src` including tests). `build` is
`rm -rf dist && tsc` so stale artifacts can't survive a rebuild.

**Neither tests nor type-check need a build first.** `@diet-app/db` publishes
`main`/`types` as `dist/`, so a fresh clone or Helm worktree used to fail 23 api
test files (`Failed to resolve entry for package "@diet-app/db"`) and ~20
`Cannot find module '@diet-app/db'` type errors that read like broken code.
Both now resolve db from source instead: `packages/api/vitest.config.ts` aliases
the package to `../db/src/index.ts` (costs ~13 s on a ~90 s suite and can never
assert against a stale build), and `packages/api/tsconfig.typecheck.json` does
the same with `paths` plus a `rootDir` widened to `packages/` (TS6059 applies
even under `noEmit`). The mapping is deliberately absent from the emitting
`tsconfig.json` — pulling `../db` into a program with `rootDir: src` is an
error, and the built artifact really does resolve through `dist/`.

What still needs `dist/` is anything that runs the api through Node's own
resolver — `pnpm --filter @diet-app/api build`, `start`, and `dev` (tsx). Root
`pnpm build` covers it: `pnpm -r build` walks the workspace in dependency
order, so db is built before api.

**web does not emit.** `packages/web/tsconfig.json` includes all of `src`
(tests included), has `noEmit: true`, and has no `tsconfig.typecheck.json`.
Type-check tests via the main config: `pnpm --filter @diet-app/web typecheck`.
`src/css.d.ts` declares `*.css` so tsgo (`build-lock tsc --noEmit`) accepts
Vite's side-effect stylesheet imports; tsc is more lenient and didn't need
it. `vite.config.ts` still excludes `**/dist/**` from vitest for the same
vitest-4 reason — a stale Vite build must not run alongside `src`.

## One suite, three projects

The root `vitest.config.ts` declares `projects: ['packages/*']`, so `vitest run`
(or `vitest run <substring>` / `--project @diet-app/web`) from the repo root
covers every test file across the three packages while each still runs under its
own config — `db`/`api` on node, `web` on jsdom. vitest is a **root
devDependency** for the same reason: a pnpm workspace that declares it only per
package has no root `node_modules/.bin/vitest`, and everything expecting one
entry point breaks on that — root-level `vitest run`, and helm's `test-suite`
(which walks up from the cwd for the binary, and whose remote rung runs
`pnpm exec vitest` at the root). Before this the full suite could only be run as
`pnpm -r test`, which no tooling knows about, so a full run never survived an
agent's turn boundary. Idea #3539.

## Test DB

Two real-Postgres suites share one gate.

- `packages/api` `routes.test.ts` — 21 `test()` cases under
  `describe.skipIf(!hasDb)`, plus the loud gate.
- `packages/db` `src/__tests__/import-products-sql.test.ts` — 4 real-Postgres
  tests (upsert-in-place, same EAN across two stores, jsonb round-trip,
  missing-ean skip), plus its own loud gate. Batching (500-row split) and
  skip-without-insert are mocked in `import-products.test.ts` — a full-store
  dump is not required to pin the bind-param bound.

Both need `TEST_DATABASE_URL` pointing at `dietapp_test` (name must end in
`_test`). Provision with `pnpm --filter @diet-app/db setup:test-db` (create +
migrate + seed + grant the `dietapp` role on mase-owned tables).

Without `TEST_DATABASE_URL` those tests would skip, so a **loud gate test fails
the run** instead; set `DIET_APP_SKIP_DB_TESTS=1` to opt out deliberately.
Silence has to be chosen — a silent skip is how the api suite went 4 commits
without executing once.

## Schema migrations

Schema changes go through `pnpm --filter @diet-app/db generate` (writes SQL
under `packages/db/drizzle/`) then `pnpm --filter @diet-app/db migrate`
(applies it, non-interactive). Never `drizzle-kit push` — it prompts for
confirmation and hangs in a Helm session, which has no TTY. After migrating
prod (`DATABASE_URL` → `dietapp`), re-provision the test DB with
`setup:test-db` above.

## Demo data

`pnpm --filter @diet-app/db seed:demo` writes the design prototype's fixtures
(15 pantry items, 7 recipes, one week of entries) with dates relative to the
run, so the spoilage ramp stays meaningful. Idempotent by explicit identity
(recipe title; pantry `(ingredient_id, location)`; entry `(date, slot)`) because
none of those tables has a unique key to conflict on. It **refuses a database
whose name doesn't end in `_test`/`_dev`** unless `--force` — production is
`dietapp`.

## Web test harness

Screen and client suites compose `packages/web/src/__tests__/harness.ts` and
`fixtures.ts` — they do not re-derive `jsonResponse` / `pathOf` / `flush` /
`mountRoot` / `makeCtx`, or the per-resource `make*` builders.

Debounced UI (scaler, catalog search) waits with `vi.waitFor` on the
fetch/DOM assertion, matching `cook-flow.test.ts` — never a hardcoded
250ms sleep. Suites that pin the delay itself (`ingredient-picker`, and
cook-confirm's close-mid-debounce case) install fake timers
(`toFake: ['setTimeout', 'clearTimeout']` so `AbortSignal.timeout` stays
native); `flush(ms)` then advances those timers instead of sleeping.

`routeFetch(routes, { unmatched })` is the fetch-side analog of
`makeSelectRouter`: keys are `"GET /api/pantry"` or `"/api/ingredients"` (any
method) or `"GET /api/recipes/:id"`. Static segments beat params at the same
depth (`/shopping-lists/current` wins over `/shopping-lists/:id`). A handler
may return a `Response`, a JSON body (wrapped as 200), or a function of
`{ url, method, path, init, params, json() }`. Unmatched requests throw
`unhandled request: METHOD /path` unless `{ unmatched: '404' }`.

## Route-test mocks

Mock-based route suites build their fake db from `__tests__/db-mock.ts` — never
hand-roll a chainable Drizzle builder.
`makeDbMock({insertRows, updateRows, deleteRows, query, select, txSelect, beforeTransaction, throwOnWrite})`
returns `{db, inserts, updates, deletes, writes}` recording what the handler
wrote, with `transaction` running the callback against those same builders;
`writes` carries each statement's table (`{kind, table, values, where}`) for
handlers that write to several. `mergedRow(fixture)` is the usual `.returning()`.
Each suite keeps a thin local `makeWriteMock(opts)` wrapper holding only its
fixtures and `db.query.X.findFirst` stubs.

### Testing Postgres error mapping

`throwOnWrite: (record) => unknown` fails a write, which is the only way to
reach a route's `isFkViolation`/`isUniqueViolation` branch. It fires as the
statement is recorded — the only point every write shape shares, since a handler
that doesn't read the row back never calls `.returning()`. Throw
`pgError('23503')` (db-mock), not a bare `{code}` object: Hono rethrows any
non-Error a handler throws instead of turning it into a 500, so the unmapped
case would look like a crash. Key on `record.table` when a handler writes to
several tables (`fkViolationOn` in recipes.test.ts).

### Never key a fixture on call order

A handler's selects are dispatched by *table*, not by invocation count:
`makeSelectRouter([[recipes, rows], [pantryItems, ({params}) => …]])`
(`select-router.ts`), passed as `select`/`txSelect`. A fixture function receives
`{table, forUpdate, params, where, limit}`, so it can key on the id the route
bound into `eq()`; an unregistered table throws naming it rather than resolving
to `[]`. `makeSelectMock`/`chainSelect` still cover single-query endpoints.
Order-keyed mocks (`call === 0 ? … : …`) silently couple fixtures to statement
order inside the handler — reordering two independent selects made 7 of 13 cook
tests fail without any behavior change. Same rule for relational stubs: key
`findFirst` on `writes.length` (pre- vs post-write), not a call counter. Table
names and bound params come from `drizzle-introspect.ts` (`tableNameOf`,
`whereParams`, `renderWhere`).

## drizzle-kit override

Root `package.json` (`packageManager: pnpm@10.33.0`): `drizzle-kit` still
declares the deprecated `@esbuild-kit/esm-loader` (predecessor of tsx) in its
`dependencies` but never imports it — at runtime it loads `drizzle.config.ts`
via `tsx/cjs/api`. The live override is
`pnpm.overrides["drizzle-kit>@esbuild-kit/esm-loader"]: "npm:tsx@^4"`, which
aliases that dead declaration to the tsx we already depend on and drops
`@esbuild-kit/{esm-loader,core-utils}` plus the stale `esbuild@0.18.20` chain
they pulled in (~56 fewer lockfile entries). pnpm needs the `drizzle-kit>`
parent selector for this nested dep; a flat `"@esbuild-kit/esm-loader"` key
would not rewrite drizzle-kit's own dependency. Remove the override once
drizzle-kit (>0.31.10) drops the vestigial dep.
