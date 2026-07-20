# Pantry + Recipe Write Endpoints Design

**Date:** 2026-07-20  
**Status:** Approved  
**Roadmap:** #236 (pantry POST/PATCH/DELETE), #237 (recipe POST/PATCH/DELETE)

## Problem

Phase 1 read surface is shipped (GET pantry/recipes/ingredients with status, filters, tests). Manual create/update/delete for pantry items and recipes is still missing, so the app cannot yet manage kitchen inventory or build a recipe collection via API.

## Goals

- Ship write endpoints for pantry and recipes that match the project-init API design.
- Zod-validate all write bodies; consistent error shapes with existing routes.
- Keep route modules focused; extract Zod schemas into small modules.
- Unit tests (mock) + real-DB integration smoke for happy-path writes.

## Non-goals

- `POST /pantry/parse`, `POST /pantry/bulk-add`
- `POST /recipes/import`, `POST /recipes/:id/fork`, `GET /recipes/pantry-match`
- Ingredient POST, profile writes, cook feedback, auto-deduct
- Nested `/recipes/:id/ingredients/*` line-item CRUD
- Changing FK cascade policy in the database schema (app-layer handling only)

## Current baseline (verified)

| Surface | State |
| ------- | ----- |
| `GET /api/pantry`, `GET /api/pantry/:id` | Shipped; attaches computed `status` via `computeStatus` |
| `GET /api/recipes`, `GET /api/recipes/:id` | Shipped; `:id` eager-loads `recipeIngredients` + `ingredient` |
| Zod | Dependency present (`zod` ^4); no write schemas yet |
| Shared helpers | `isUuid`, `isIsoDate`, `notFound`, `getPagination` |
| FKs | `recipe_ingredients` and `meal_plan_entries` → `recipes` are NO ACTION (no cascade) |
| Tests | Mock unit suites per route; `routes.test.ts` is real-DB smoke (GET-only today) |

## API contracts

### Shared conventions

| Concern | Behavior |
| ------- | -------- |
| Auth | Unchanged — all `/api/*` except health require Bearer token (unit tests omit config) |
| Path UUID | `isUuid(id)` → `400 { error: 'Invalid id format' }` before DB |
| Missing row | `notFound(c)` → `404 { error: 'Not found' }` |
| Body validation | Zod → `400 { error: 'Validation failed', details: z.flattenError(error) }` (Zod 4). Invalid/non-JSON body → `400 { error: 'Invalid JSON body' }` (try/catch around `c.req.json()`) |
| FK violations | Prefer pre-checks where data is already loaded (e.g. pantry POST loads ingredient for shelf life → missing ingredient = `400`). Catch remaining Postgres `23503` → `400 { error: 'Invalid reference' }`. Explicit conflict guards (meal plan / child fork) use `409` — not unique-constraint `23505` (these paths have no relevant unique constraints). Recipe DELETE: check-then-delete; also catch `23503` as belt-and-suspenders → `409` |
| Content-Type | JSON bodies only |
| Cross-field consistency | **Out of scope** for this slice: no checks that `expiresDate >= addedDate`, `totalTime >= prepTime`, or `parentRecipeId !== self` |

### #236 Pantry

#### POST `/api/pantry`

Create one pantry item (not bulk — bulk is a later endpoint).

**Body:**

| Field | Required | Notes |
| ----- | -------- | ----- |
| `ingredientId` | yes | UUID; must exist in `ingredients` |
| `quantity` | yes | Positive number (Zod coerces string numerics); stored as Drizzle `numeric` |
| `unit` | yes | Non-empty string |
| `location` | yes | Enum: `fridge` \| `freezer` \| `pantry` \| `counter` |
| `addedDate` | no | ISO date `YYYY-MM-DD`; default = today (UTC date string `YYYY-MM-DD`) |
| `expiresDate` | conditional | ISO date. If omitted: compute from ingredient `shelfLife` for `location` + `addedDate`. If that shelf-life key is null/missing, require `expiresDate` (`400`) |
| `opened` | no | Boolean; default `false` |

**Success:** `201` JSON = inserted row + computed `status` (same enrichment as GET). Response `quantity` is a string (Drizzle `numeric` read shape), same as GET.

**Errors:** `400` validation / missing shelf life without expiresDate / missing or invalid ingredient; `404` not used on create.

**Expiry computation:** Read ingredient row. `shelfLife` keys follow `{location}_days` for known locations. Seeded data only ever has `fridge_days`, `freezer_days`, `pantry_days` (never `counter_days`). Therefore `location: "counter"` without client `expiresDate` always → `400` until data provides a key. Treat null/missing key as “no default.” `expiresDate = addedDate + N days` when N is a finite non-negative number.

#### PATCH `/api/pantry/:id`

Partial update. Allowed fields only: `quantity`, `unit`, `location`, `addedDate`, `expiresDate`, `opened`.

- Do **not** allow changing `ingredientId` (wrong ingredient → delete + create).
- Empty body or no recognized fields → `400`.
- Omitted field = leave unchanged; `null` only allowed where the column is nullable (none of the PATCH fields are nullable except conceptually — reject null on non-null columns).
- **Expiry on PATCH is client-owned:** the server never recomputes `expiresDate` from shelf life when `location`, `addedDate`, or `opened` change. If the client wants a new expiry after those changes, they must send `expiresDate` explicitly. Opened-driven shelf-life shortening (architecture note “Recalculates shelf life”) is a **non-goal for #236**.
- Bump `updatedAt` to `now()`.
- **Success:** `200` row + `status`. Missing id → `404`.

#### DELETE `/api/pantry/:id`

Hard delete. **Success:** `204` empty body. Missing → `404`.

---

### #237 Recipes

#### POST `/api/recipes`

Create recipe header + ingredients in **one transaction**.

**Body:**

| Field | Required | Notes |
| ----- | -------- | ----- |
| `title` | yes | Non-empty string |
| `sourceType` | no | Default `"manual"`. Allowed: `manual` \| `imported` \| `ai` \| `forked`. **Supersedes** project-init vocabulary (`user_created` / `ai_generated` / `imported`) — this write contract is canonical going forward |
| `sourceUrl` | no | Nullable string / URL-ish text |
| `parentRecipeId` | no | UUID of parent (forks later); optional on manual create |
| `steps` | no | `string[]`; default `[]`. **Deliberate v1 simplification** of project-init structured steps `[{ instruction, timer_minutes? }]`; schema is untyped jsonb so structured steps can land later without a migration. Timers/import structured steps are out of scope for #237 |
| `prepTime` | no | Non-negative integer minutes |
| `totalTime` | no | Non-negative integer minutes |
| `servings` | no | Positive integer; default `1` |
| `effortScore` | no | Integer 1–5 if present |
| `tags` | no | `string[]`; default `[]` |
| `cuisineType` | no | Nullable string |
| `ingredients` | yes | Array, **min 1** of ingredient lines |

**Ingredient line:**

| Field | Required | Notes |
| ----- | -------- | ----- |
| `ingredientId` | yes | UUID |
| `quantity` | yes | Positive number |
| `unit` | yes | Non-empty string |
| `optional` | no | Default `false` |
| `notes` | no | Nullable string |

**Not accepted from client on create:** `userRating`, `timesCooked` (server defaults).

**Success:** `201` full recipe with `recipeIngredients` (+ nested `ingredient` if same as GET `:id` shape). Prefer re-fetch via relational `findFirst` after insert so response matches GET.

**Errors:** `400` validation / bad FK; transaction rolls back on any failure.

#### PATCH `/api/recipes/:id`

Partial update of header fields: `title`, `sourceType`, `sourceUrl`, `parentRecipeId`, `steps`, `prepTime`, `totalTime`, `servings`, `effortScore`, `tags`, `cuisineType`.

- **Never** accept client writes of `timesCooked` or `userRating` on this endpoint.
- **Null semantics:** omitted key = leave unchanged; JSON `null` clears nullable columns only (`sourceUrl`, `parentRecipeId`, `cuisineType`; ingredient line `notes` on replace). Non-nullable fields reject null via Zod.
- If `ingredients` is **present** (including empty array): treat as **full replace** — in one transaction delete existing `recipe_ingredients` for the recipe and insert the new set. Empty array → `400` (min 1), same as create.
- If `ingredients` is **omitted**: leave ingredient lines unchanged.
- Empty patch (no header fields and no `ingredients`) → `400`.
- Bump `updatedAt`.
- **Success:** `200` full recipe (GET `:id` shape). Missing → `404`. Response ingredient `quantity` is string (numeric read shape).

#### DELETE `/api/recipes/:id`

App-layer cascade for ingredient lines only:

1. Check whether any `meal_plan_entries` reference this recipe as `recipeId` or `substituteRecipeId`. If yes → **`409 { error: 'Recipe is referenced by meal plan entries' }`** and do not delete.
2. Check whether any recipe has `parentRecipeId = id`. If yes → **`409 { error: 'Recipe has forked child recipes' }`** and do not delete.
3. In a transaction: delete `recipe_ingredients` where `recipe_id = id`, then delete the recipe. Catch concurrent FK race (`23503`) → same `409` family.

**Success:** `204` empty. Missing → `404`.

## Error response shapes

```
400 { error: 'Validation failed', details: <zod flatten> }
400 { error: 'Invalid JSON body' }
400 { error: 'Invalid id format' }          // path UUID
400 { error: 'Invalid reference' }          // FK 23503 / missing ingredient
400 { error: string }                       // other domain validation (e.g. expiresDate required)
404 { error: 'Not found' }
409 { error: 'Recipe is referenced by meal plan entries' }
409 { error: 'Recipe has forked child recipes' }
204 (no body)
201 / 200 (resource JSON)
```

## Module layout

| File | Responsibility |
| ---- | -------------- |
| `packages/api/src/schemas/pantry.ts` | Zod schemas for pantry POST/PATCH bodies |
| `packages/api/src/schemas/recipes.ts` | Zod schemas for recipe POST/PATCH + ingredient lines |
| `packages/api/src/responses.ts` | Add `badRequest(c, error, details?)` and `conflict(c, error)` helpers (optional but preferred over inlined status codes) |
| `packages/api/src/routes/pantry.ts` | Wire POST/PATCH/DELETE; keep GET unchanged |
| `packages/api/src/routes/recipes.ts` | Wire POST/PATCH/DELETE; keep GET unchanged |
| `packages/api/src/pantry-expiry.ts` (or inline small helper) | `resolveExpiresDate(ingredient, location, addedDate, explicit?)` |
| Tests | Extend `pantry.test.ts`, `recipes.test.ts`; write smokes in `routes.test.ts` |

Route files stay under 300 lines; if writes push past that, split validation parsing helpers rather than bloating handlers.

## Testing strategy

### Unit (mock DB)

- POST pantry: valid body → 201 + status; invalid location → 400; missing required → 400; invalid UUID path on PATCH/DELETE → 400 before DB.
- PATCH pantry: partial update path; 404 when not found.
- DELETE pantry: 204; 404.
- POST recipe: inserts header + lines; empty ingredients → 400; validation errors.
- PATCH recipe: header-only vs ingredients replace; 404.
- DELETE recipe: 204 when free; 409 when meal-plan (or child) references exist; 404.

Mocks for write paths will need `insert`/`update`/`delete`/`transaction` stubs (extend beyond `makeSelectMock` as needed). Prefer thin fakes that record calls over deep Drizzle emulation.

### Integration (`routes.test.ts`, gated on `TEST_DATABASE_URL`)

- Resolve `ingredientId` from seeded data (e.g. first row of `GET /api/ingredients`) — never hardcode UUIDs; recipes are not seeded but ingredients are.
- Create pantry item → GET by id → PATCH → DELETE cleanup.
- Create recipe with ≥1 ingredient line → GET by id verifies lines → DELETE cleanup.
- Assert cleanup so the suite does not leave permanent rows (delete in `finally` / afterAll).

## Alternatives considered

| Option | Decision |
| ------ | -------- |
| Array POST for pantry (design said “item(s)”) | **Single item** for #236; bulk-add is its own route later |
| Always require client `expiresDate` | **Auto from shelfLife** when possible (design doc intent) |
| Nested ingredient routes | **Nested body + full replace on PATCH** — fewer round-trips for v1 |
| Cascade-delete meal plan refs on recipe delete | **409 block** — meal history must not vanish silently |
| Soft-delete recipes | **Hard delete** — simpler; no soft-delete column today |

## Implementation notes for the plan phase

- Use Drizzle `db.transaction` for multi-step recipe writes/deletes.
- Numeric columns: Zod validates positive number; on insert pass a value Drizzle accepts (number or `String(n)`); **response `quantity` remains string** like GET.
- Do not change schema/migrations in this work.
- Mark roadmap #236 and #237 done only after targeted tests + typecheck pass and deploy.

## Approval

Approved 2026-07-20 with recommendations: single-item pantry POST, auto-expiry when shelf life allows, ingredients via create/replace only, recipe delete blocked (409) when meal-plan or child-fork references remain.
