# Shopping Lists Implementation Plan

**Goal:** Derive a week's shopping list from the meal plan minus pantry stock, and make the list writable end-to-end — check off, hand-add, complete into pantry rows.

**Architecture:** All arithmetic lives in pure modules with no DB access (`shopping-aggregate.ts`, `pantry-location.ts`, `shopping-sort.ts`), mirroring the `cook-deduct.ts` precedent; routes load rows, call the pure planner, and apply the result inside one transaction. Generation is an upsert-merge keyed on a new `(list_id, ingredient_id, unit)` unique index, so check-offs and hand-added rows survive regeneration. `done` is terminal and owned exclusively by `POST /:id/complete`, exactly as `cooked` is owned by `POST /meal-plans/:id/cook`.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, Zod, Vitest, pnpm workspace (`@diet-app/api`, `@diet-app/db`)

**Spec:** `docs/plans/2026-08-04-shopping-lists-design.md`

**Roadmap:** #381 (generation), #382 (writes + purchase tracking)

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `packages/api/src/shopping-aggregate.ts` | Pure: plan entries + recipes + lines + pantry → item specs |
| `packages/api/src/pantry-location.ts` | Pure: ingredient category → storage location |
| `packages/api/src/shopping-sort.ts` | Pure: item display ordering |
| `packages/api/src/schemas/shopping-lists.ts` | Zod bodies for list/item/generate/complete |
| `packages/api/src/schemas/ingredients.ts` | Zod body for the ingredient PATCH |
| `packages/api/src/routes/shopping-list-generate.ts` | `POST /generate` |
| `packages/api/src/routes/shopping-list-items.ts` | Item writes |
| `packages/api/src/routes/shopping-list-complete.ts` | `POST /:id/complete` |

**Modified:** `packages/db/src/schema/shopping-lists.ts`, `packages/db/src/seed-core.ts`, `packages/api/src/units.ts`, `packages/api/src/cook-deduct.ts`, `packages/api/src/routes/shopping-lists.ts`, `packages/api/src/routes/ingredients.ts`, `packages/api/src/__tests__/db-mock.ts`, `packages/db/src/__tests__/{seed-core,schema}.test.ts`, `CLAUDE.md`

Three shared test/helper files need extending before the features that depend on them can be tested at all. Each is called out in the task that needs it, but they are listed here because they are easy to miss when scanning for "new feature" work:

| File | Gap | Needed by |
| --- | --- | --- |
| `packages/db/src/__tests__/schema.test.ts` | `COLUMN_SPECS.shoppingListItems` has no `unit`/`source`, and `bought` lacks `notNull` — Task 1's migration makes this suite fail | Task 1 |
| `packages/db/src/__tests__/seed-core.test.ts` | `makeMockDb` captures `onConflictTarget` but not the `set` object, so it cannot observe the bug being fixed | Task 1 |
| `packages/api/src/__tests__/db-mock.ts` | the insert recorder has no `.onConflictDoUpdate()` chain method, which is generate's central write | Task 5 |

---

### Task 1: Schema migration + seed fix

**Files:**
- Modify: `packages/db/src/schema/shopping-lists.ts`
- Modify: `packages/db/src/seed-core.ts`
- Modify: `packages/db/src/__tests__/seed-core.test.ts`
- Modify: `packages/db/src/__tests__/schema.test.ts`
- Create: `packages/db/drizzle/<generated>.sql` (via `drizzle-kit generate`)

**Contracts:**

`shoppingListItems` gains:
```ts
unit: text('unit').notNull(),
source: text('source').notNull().default('generated'),
bought: boolean('bought').notNull().default(false),   // was nullable
```
plus `uniqueIndex().on(listId, ingredientId, unit)`. `shoppingLists` gains `uniqueIndex().on(weekStarting)`.

In `seed-core.ts`, remove `isPantryStaple` from the `excludedColumns({...})` argument inside `onConflictDoUpdate`. It stays in the `.values()` insert shape. Add a comment stating why: the column is user-owned (toggled via `PATCH /api/ingredients/:id`) and a re-seed must not overwrite curation. Every other column there stays — it is catalog data that must keep refreshing.

**Test Cases:**

```ts
// seed-core.test.ts
it('does not overwrite isPantryStaple on re-seed', async () => {
  // the conflict-update set must omit is_pantry_staple entirely
  const { db, calls } = makeMockDb();
  await seedDatabase(db, [ingredientRow({ name: 'salt', isPantryStaple: true })]);
  expect(Object.keys(calls.onConflictSet)).not.toContain('isPantryStaple');
  expect(Object.keys(calls.onConflictSet)).toEqual(
    expect.arrayContaining(['aliases', 'category', 'nutritionPer100g', 'shelfLife', 'tags']),
  );
});

it('still seeds isPantryStaple for a newly inserted ingredient', async () => {
  const { db, calls } = makeMockDb();
  await seedDatabase(db, [ingredientRow({ name: 'salt', isPantryStaple: true })]);
  expect(calls.insertValues[0].isPantryStaple).toBe(true);
});
```

**Constraints:**
- `makeMockDb` in `seed-core.test.ts` currently captures only `onConflictTarget`, **not** the `set` object. Extend it to capture `set` before writing the assertion above. Skipping this produces a test that passes whether or not the bug is fixed — that is the whole failure mode this task exists to prevent. (The `ingredientRow(...)` factory in the sketch above is illustrative; that file currently uses a literal `SAMPLE` array. Either is fine.)
- **`schema.test.ts` will fail until updated.** Its `COLUMN_SPECS.shoppingListItems` block (around line 107) asserts an exact column set plus per-column `notNull`/`hasDefault` flags. Add `unit: { type: 'PgText', notNull: true }` and `source: { type: 'PgText', notNull: true, hasDefault: true }`, and change `bought` to `{ type: 'PgBoolean', notNull: true, hasDefault: true }`. This is not optional cleanup — the suite fails on the schema change itself, and leaving it for Task 9's full run detaches the breakage from its cause by eight commits.
- `ADD COLUMN unit text NOT NULL` fails if rows exist. Before running `migrate`, verify with `psql "$DATABASE_URL" -c 'select count(*) from shopping_list_items'`. Expected 0 (no endpoint has ever written to this table). If non-zero, stop and report — do not invent a backfill value, since the correct unit depends on data nobody has looked at.
- Migration workflow is `pnpm --filter @diet-app/db generate` then `migrate` — never `drizzle-kit push` (needs a TTY, hangs in a Helm session).

**Verification:**
```bash
pnpm --filter @diet-app/db generate
psql "$DATABASE_URL" -c 'select count(*) from shopping_list_items'   # expect 0
pnpm --filter @diet-app/db migrate                       # applies to DATABASE_URL (dietapp)
pnpm --filter @diet-app/db setup:test-db                 # re-migrates dietapp_test
pnpm --filter @diet-app/db build
build-lock pnpm --filter @diet-app/db test seed-core schema
```
Expected: migration applies to both databases, seed-core and schema tests pass.

**Commit after passing.** `[Mode: Direct]`

---

### Task 2: Pure aggregation module

**Files:**
- Create: `packages/api/src/shopping-aggregate.ts`
- Modify: `packages/api/src/units.ts`
- Modify: `packages/api/src/cook-deduct.ts` (drop its private `round6`, import the shared one)
- Test: `packages/api/src/__tests__/shopping-aggregate.test.ts`
- Test: `packages/api/src/__tests__/units.test.ts` (extend)

**Contracts:**

```ts
// units.ts
export function baseUnit(dimension: Dimension): 'g' | 'ml' | 'pieces';
export function round6(n: number): number;   // promoted from cook-deduct.ts

// shopping-aggregate.ts
export interface PlanEntry {
  id: string;
  recipeId: string | null;
  substituteRecipeId: string | null;
  servings: number;
  status: string;               // planned | cooked | skipped | substituted
}
export interface AggregateRecipeLine {
  ingredientId: string;
  quantity: number;
  unit: string;
  optional: boolean;
}
export interface PantrySupplyRow {
  ingredientId: string;
  quantity: number;
  unit: string;
  expiresDate: string;          // YYYY-MM-DD
}
export interface GeneratedItem {
  ingredientId: string;
  unit: string;                 // base unit for the dimension
  quantityNeeded: number;
  quantityInPantry: number;
  netToBuy: number;
  category: string;
}
export interface SkippedLine {
  ingredientId: string | null;  // null when the whole entry was unusable
  entryId: string;
  reason: 'unknown_unit' | 'recipe_missing' | 'bad_scale';
}

export function aggregateShoppingList(input: {
  entries: PlanEntry[];
  recipesById: Map<string, { servings: number }>;
  linesByRecipe: Map<string, AggregateRecipeLine[]>;
  pantryRows: PantrySupplyRow[];
  ingredientsById: Map<string, { category: string }>;
  today: string;
}): { items: GeneratedItem[]; skipped: SkippedLine[] };
```

**Test Cases:**

```ts
it('aggregates the same ingredient across two recipes into one row')
// 400 g in recipe A + 500 g in recipe B → one item, quantityNeeded 900, unit 'g'

it('splits one ingredient across dimensions into separate rows')
// 400 g + 2 pieces of the same ingredient → two items, 'g' and 'pieces'

it('scales lines by entry servings over recipe servings')
// recipe.servings 4, entry.servings 2, line 400 g → 200 g

it('converts non-base units to the dimension base')
// 0.5 kg → 500 g ; 1 l → 1000 ml

it('excludes optional lines')

it('excludes cooked entries')            // already deducted by the cook flow
it('excludes skipped entries')
it('includes substituted entries using substituteRecipeId')
it('prefers substituteRecipeId over recipeId when both are set')
it('ignores freeform entries with no recipe')   // contributes nothing, not a skip

it('subtracts pantry stock in the same dimension')
// need 900 g, pantry 300 g → quantityInPantry 300, netToBuy 600

it('ignores pantry stock in a different dimension')
// need 900 g, pantry 2 pieces → quantityInPantry 0, netToBuy 900

it('excludes pantry rows expired before today')
// expiresDate '2026-08-03', today '2026-08-04' → not counted

it('counts a pantry row expiring exactly today')

it('floors netToBuy at zero when pantry covers demand')
// need 200 g, pantry 500 g → netToBuy 0, item still present

it('keeps fully covered rows rather than dropping them')

it('reports a line with an unresolvable unit as skipped')
// unit 'pinch' → skipped { reason: 'unknown_unit' }, not silently dropped

it('reports an entry whose recipe is missing from recipesById')
it('reports a non-finite scale as bad_scale')     // recipe.servings 0

it('rounds quantities to six decimals')
it('does not mutate its inputs')
it('returns a deterministic item order for identical input')
```

**Constraints:**
- No DB imports, no Drizzle, no `Date.now()` — `today` is a parameter so tests are deterministic.
- Reuse `toBase` / `resolveUnit` from `units.ts`; never re-implement conversion, and never cross dimensions.
- `round6` currently lives unexported in `cook-deduct.ts`. Move it to `units.ts` and have both modules import it, so the two planners cannot drift to different rounding. `cook-deduct.test.ts` must stay green across the move.
- A line that cannot be aggregated must appear in `skipped`. Silent drops are the failure mode this contract exists to prevent.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test shopping-aggregate units
build-lock pnpm --filter @diet-app/api typecheck
```
Expected: all pass.

**Commit after passing.** `[Mode: Delegated]`

---

### Task 3: Location + sort helpers

**Files:**
- Create: `packages/api/src/pantry-location.ts`
- Create: `packages/api/src/shopping-sort.ts`
- Test: `packages/api/src/__tests__/pantry-location.test.ts`
- Test: `packages/api/src/__tests__/shopping-sort.test.ts`

**Contracts:**

```ts
// pantry-location.ts
export type StorageLocation = 'fridge' | 'freezer' | 'pantry' | 'counter';
export function locationForCategory(category: string): StorageLocation;

// shopping-sort.ts — sorts a copy, never mutates
export function sortListItems<T extends {
  id: string;
  category: string;
  ingredient?: { name?: string | null; isPantryStaple?: boolean | null } | null;
}>(items: T[]): T[];
```

**Test Cases:**

```ts
// pantry-location
it('maps produce, dairy and protein to fridge')
it('maps frozen to freezer')
it('maps grain, spice, condiment and other to pantry')
it('falls back to pantry for an unknown category')
it('covers every category present in the seed data')
// the 8: produce, protein, dairy, grain, spice, condiment, frozen, other

// shopping-sort
it('places non-staples before staples')
it('sorts by category alphabetically within a staple group')
it('sorts by ingredient name within a category')
it('tie-breaks on id')
it('treats a null or missing ingredient as a non-staple with an empty name')
it('does not mutate the input array')
```

**Constraints:**
- `locationForCategory` must return a value in the `locationEnum` of `schemas/pantry.ts` — a location the pantry POST would reject is a runtime failure, not a type error.
- Sort must be total (id tie-break) so two identical GETs never differ in order — the same rule the list endpoints follow.
- `isPantryStaple` is read live off the joined ingredient, never snapshotted onto the item row.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test pantry-location shopping-sort
```
Expected: all pass.

**Commit after passing.** `[Mode: Direct]`

---

### Task 4: `PATCH /api/ingredients/:id`

**Files:**
- Create: `packages/api/src/schemas/ingredients.ts`
- Modify: `packages/api/src/routes/ingredients.ts`
- Test: `packages/api/src/__tests__/ingredients.test.ts` (extend)

**Contracts:**

```ts
export const ingredientPatchSchema = z
  .object({ isPantryStaple: z.boolean().optional() })
  .strict();
```

`PATCH /:id` → validate `isUuid`, `parseJsonBody(c, ingredientPatchSchema, { requireNonEmpty: true })`, `buildPatch(data, ingredients)` plus `updatedAt`, update, 404 on empty `.returning()`.

**Test Cases:**

```ts
it('toggles isPantryStaple and returns the updated row')
it('returns 400 for a malformed id')
it('returns 400 for an empty patch body')
it('returns 400 for an unknown field')          // .strict()
it('returns 404 when the ingredient does not exist')
it('returns 404 when the row vanishes between check and update')  // empty returning
```

**Constraints:**
- Register `PATCH /:id` after the existing `GET /:id`; no literal-vs-param collision here, but keep literals first as a matter of course.
- Do not widen the schema beyond `isPantryStaple` — general catalog editing is idea #3231 and carries an unresolved seed-vs-user ownership question per column.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test ingredients
```
Expected: all pass.

**Commit after passing.** `[Mode: Direct]`

---

### Task 5: `POST /shopping-lists/generate`

**Files:**
- Create: `packages/api/src/routes/shopping-list-generate.ts`
- Create: `packages/api/src/schemas/shopping-lists.ts`
- Modify: `packages/api/src/routes/shopping-lists.ts` (mount the sub-router)
- Modify: `packages/api/src/__tests__/db-mock.ts` (add upsert support — see Constraints)
- Test: `packages/api/src/__tests__/shopping-list-generate.test.ts`

**Contracts:**

```ts
export const generateSchema = z.object({
  weekStarting: z.string().refine(isIsoDate, { message: 'Invalid date' }),
}).strict();

export function shoppingListGenerateRoutes(db: Db): Hono;
```

Response `200 { list, items, skipped }` — `items` sorted via `sortListItems`.

Transaction body:
1. Snap `weekStarting` to its ISO Monday with `getISOWeekBounds`.
2. `SELECT ... FOR UPDATE` the list for that week. Exists and `status !== 'draft'` → 409. Missing → insert (unique violation on `week_starting` → 409).
3. Load week entries, the referenced recipes and their lines, pantry rows for the involved ingredients, and those ingredients.
4. Call `aggregateShoppingList`.
5. Upsert items on `(list_id, ingredient_id, unit)`, setting **only** `quantityNeeded`, `quantityInPantry`, `netToBuy`, `category`.
6. Delete `source = 'generated' AND bought = false` rows for the list whose `(ingredient_id, unit)` is absent from the fresh plan.

**Test Cases:**

```ts
it('creates a list and its items for a week with no existing list')
it('snaps a mid-week date to the ISO Monday')
// weekStarting '2026-08-06' (Thu) → list.weekStarting '2026-08-03'
it('returns 400 for a malformed weekStarting')
it('returns 400 for an unknown body field')

it('rewrites quantities on regeneration without touching bought')
// existing item bought=true → still bought after regenerate, quantities updated
it('preserves customNote on regeneration')
it('preserves manual rows absent from the plan')
// source='manual' row survives regeneration untouched
it('deletes generated unbought rows the plan no longer calls for')
it('keeps a generated row that was already bought even when the plan drops it')

it('returns 409 when the existing list is not draft')
it('returns 409 on a unique violation for week_starting')   // concurrent generate

it('returns skipped lines from the aggregator in the response')
it('creates an empty list when the week has no entries')
```

**Constraints:**
- **`db-mock.ts` cannot express this route's central write yet.** Its insert recorder (`makeRecorder`) exposes only `.values()` / `.where()` / `.returning()` — there is no `.onConflictDoUpdate()`. Extend the insert builder with that chain method, recording `{ target, set }` onto the emitted `WriteRecord` so a test can assert *which* columns the upsert rewrites (the whole point is that it touches the three quantity fields and not `bought` / `customNote` / `source`). Do this first; the alternative — rewriting the route as select-then-conditionally-insert-or-update to fit the existing mock — trades a real upsert's atomicity for test convenience and must not be chosen.
- `POST /generate` is a single-segment literal that collides with `/:id`; register it before any single-segment param route.
- Mock suites build the fake db from `__tests__/db-mock.ts` and dispatch select fixtures **by table** via `makeSelectRouter` — never by call order. Key relational stubs on `writes.length`, not a call counter.
- Use `throwOnWrite` with `pgError('23505')` to reach the unique-violation branch; throw the real `pgError`, not a bare `{ code }` object.
- Numeric columns take strings on write (`String(value)`).
- The route must not do arithmetic — everything numeric comes back from `aggregateShoppingList`.
- Errors go through `responses.ts` helpers; map PG codes via `pg-errors.ts` and `throw err` for anything unknown so `onError` still sees it.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test shopping-list-generate
build-lock pnpm --filter @diet-app/api typecheck
```
Expected: all pass.

**Commit after passing.** `[Mode: Delegated]`

---

### Task 6: List reads, status PATCH, delete

**Files:**
- Modify: `packages/api/src/routes/shopping-lists.ts`
- Modify: `packages/api/src/schemas/shopping-lists.ts`
- Test: `packages/api/src/__tests__/shopping-lists.test.ts` (extend)

**Contracts:**

```ts
export const listPatchSchema = z
  .object({ status: z.enum(['draft', 'shopping', 'done']).optional() })
  .strict();
```

`'done'` is deliberately **inside** the enum even though PATCH always refuses it, mirroring `mealPlanPatchSchema`, which includes `'cooked'` for exactly this reason. The refusal belongs in the handler, not the schema: a client asking to mark a list done has made a routing mistake, not a validation error, and a 409 saying *"use `POST /:id/complete`"* points at the fix where a bare 400 `Validation failed` would not. See `routes/meal-plans.ts:112-119` for the shape to copy.

- `GET /` — `getPagination(c)`, `.orderBy(desc(weekStarting), asc(id))`, no items.
- `GET /:id` — list with items and their ingredients, sorted via `sortListItems`.
- `GET /current` — unchanged selection logic; apply `sortListItems` to its items.
- `PATCH /:id` — status only.
- `DELETE /:id` — delete items then the list in one transaction; 409 when `status === 'done'`.

**Test Cases:**

```ts
it('paginates and orders lists newest week first with an id tie-break')
it('returns a list with items sorted non-staples first')
it('sorts /current items the same way')
it('returns 404 for an unknown list id')
it('returns 400 for a malformed id')

it('updates status from draft to shopping')
it('returns 409 when PATCH tries to set status done')
// message must name POST /:id/complete — the 409 exists to redirect, not just refuse
it('returns 409 when PATCH tries to move a done list back to shopping')
it('accepts a no-op status done on an already-done list')   // unchanged value passes
it('returns 400 for an empty patch body')
it('returns 400 for a status outside the enum')

it('deletes a list and its items')
it('returns 409 when deleting a done list')
it('returns 404 when deleting an unknown list')
```

**Constraints:**
- `done` is unreachable via PATCH in both directions: setting it on a non-done list 409s (pointing at `/complete`), and a `done` list rejects any change away from it. Re-sending the unchanged value passes, matching how `routes/meal-plans.ts` treats `cooked`. The transition has pantry side effects a plain status flip would skip.
- Register `/current` and `/generate` before `/:id`.
- `GET /:id` and `/current` need `with: { items: { with: { ingredient: true } } }` — this is the eager-load case where the relational API is correct. `GET /` has no relations and uses the core builder, per the project's Drizzle rule.
- Every list query ends with an id tie-break before `.limit()/.offset()`.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test shopping-lists
```
Expected: all pass.

**Commit after passing.** `[Mode: Delegated]`

---

### Task 7: Item writes

**Files:**
- Create: `packages/api/src/routes/shopping-list-items.ts`
- Modify: `packages/api/src/schemas/shopping-lists.ts`
- Modify: `packages/api/src/routes/shopping-lists.ts` (mount)
- Test: `packages/api/src/__tests__/shopping-list-items.test.ts`

**Contracts:**

```ts
export const itemCreateSchema = z.object({
  ingredientId: uuidField,
  quantityNeeded: z.coerce.number().positive(),
  unit: z.string().trim().min(1),
  customNote: z.string().trim().min(1).optional(),
}).strict();

export const itemPatchSchema = z.object({
  bought: z.boolean().optional(),
  quantityNeeded: z.coerce.number().positive().optional(),
  netToBuy: z.coerce.number().nonnegative().optional(),
  customNote: z.string().trim().min(1).nullable().optional(),
}).strict();
```

`POST /:id/items` — resolve the submitted unit via `toBase`, **store the base unit and the converted quantity** (`1 kg` → `1000 g`); derive `category` from the ingredient; set `source: 'manual'`, `bought: false`, `quantityInPantry: 0`, `netToBuy: quantityNeeded`.

**Test Cases:**

```ts
it('adds a manual item with source manual and bought false')
it('derives category from the ingredient rather than the request')
it('normalizes the unit and quantity to the dimension base')
// { quantityNeeded: 1, unit: 'kg' } → stored 1000 'g'
it('returns 409 when the normalized (ingredient, unit) already exists')
// a 'kg' add against an existing generated 'g' row must collide, not duplicate
it('returns 400 for an unresolvable unit')
it('returns 400 Invalid reference for an unknown ingredientId')  // 23503
it('returns 404 when the list does not exist')

it('toggles bought')
it('updates netToBuy and customNote')
it('clears customNote with null')
it('returns 400 when the patch tries to change unit or ingredientId')  // .strict()
it('returns 400 for an empty patch body')
it('returns 404 patching an unknown item')

it('deletes an item and returns 204')
it('returns 404 deleting an unknown item')
```

**Constraints:**
- Unit normalization is load-bearing, not cosmetic: without it the `(list_id, ingredient_id, unit)` unique index cannot see a `kg` row and a `g` row as the same thing, and duplicate protection silently does nothing.
- `netToBuy` is `nonnegative` (0 is meaningful — "I have enough"), `quantityNeeded` is `positive`.
- Do not net a manual row against the pantry. The user typed what they want; regeneration never revisits manual rows, so a netted value could never be refreshed.
- `/items/:id` is two segments and does not collide with the one-segment `/:id` — no ordering hazard, but keep literals first regardless.
- Use `throwOnWrite` keyed on `record.table` for the FK and unique branches.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test shopping-list-items
```
Expected: all pass.

**Commit after passing.** `[Mode: Delegated]`

---

### Task 8: `POST /shopping-lists/:id/complete`

**Files:**
- Create: `packages/api/src/routes/shopping-list-complete.ts`
- Modify: `packages/api/src/schemas/shopping-lists.ts`
- Modify: `packages/api/src/routes/shopping-lists.ts` (mount)
- Test: `packages/api/src/__tests__/shopping-list-complete.test.ts`

**Contracts:**

```ts
export const completeSchema = z.object({
  overrides: z.array(z.object({
    itemId: uuidField,
    location: z.enum(['fridge', 'freezer', 'pantry', 'counter']),
  })).optional(),
}).strict();
```

Response `200 { list, added, skipped }` where `skipped` entries are `{ itemId, reason: 'no_shelf_life' }`.

Transaction body:
1. `SELECT ... FOR UPDATE` the list; `status === 'done'` → 409.
2. Load items with `bought = true AND net_to_buy > 0`, joined to their ingredients.
3. Per item: `location` = override ?? `locationForCategory(item.category)`; `expiresDate` = `resolveExpiresDate(ingredient.shelfLife, location, today)`; null → push to `skipped` and continue.
4. Insert `pantry_items` with `quantity = netToBuy`, `unit = item.unit`, `addedDate = today`, `opened = false`.
5. `UPDATE list SET status = 'done'`.

**Test Cases:**

```ts
it('creates pantry rows for bought items with net to buy')
it('uses the item unit and netToBuy as the pantry quantity')
it('infers location from the item category')
it('applies a per-item location override')
it('derives expiresDate from the ingredient shelf life for that location')
it('skips items whose shelf life has no entry for the location')
// reported in skipped, does not abort the completion
it('ignores unbought items')
it('ignores bought items whose netToBuy is zero')
it('sets the list status to done')
it('returns 409 when the list is already done')
it('returns 404 for an unknown list')
it('returns 400 for a malformed override body')
it('completes a list with no bought items, adding nothing')
```

**Constraints:**
- One transaction — a partial completion must never leave pantry rows written with the list still not `done`, nor the reverse.
- A skipped item is reported, not fatal. A 400 that files nothing is worse than a partial completion that says what it could not file.
- 409-on-already-done is what makes double-add impossible; it is the same terminality `cooked` has.
- Reuse `resolveExpiresDate` from `pantry-expiry.ts` — do not re-derive expiry arithmetic.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test shopping-list-complete
build-lock pnpm --filter @diet-app/api typecheck
```
Expected: all pass.

**Commit after passing.** `[Mode: Delegated]`

---

### Task 9: Integration tests, docs, deploy

**Files:**
- Modify: `packages/api/src/__tests__/routes.test.ts`
- Modify: `CLAUDE.md`

**Contracts:** real-DB round trip against `dietapp_test`, proving what mocks structurally cannot.

**Test Cases:**

```ts
it('generates a list from a seeded meal plan week')
// seed ingredients + recipe + entries → POST /generate → items with real netToBuy

it('preserves bought flags and manual rows across a regeneration')
// generate → PATCH an item bought → POST /:id/items manual → regenerate
// → both survive, plan quantities refreshed

it('completes a list into real pantry rows')
// tick items → POST /:id/complete → GET /pantry shows rows with derived expiry

it('rejects a second completion with 409')

it('enforces the (list_id, ingredient_id, unit) unique index at the DB level')
it('enforces the week_starting unique index at the DB level')
```

**Constraints:**
- Needs `TEST_DATABASE_URL` on `dietapp_test` (name must end in `_test`) and a built `@diet-app/db`. Provision with `pnpm --filter @diet-app/db setup:test-db`.
- The two index tests must hit the real DB — a mock cannot prove a constraint exists.

**CLAUDE.md additions:**
- Shopping list items are keyed `(list, ingredient, dimension)` and stored in base units; manual adds normalize before writing, or the unique index stops working.
- Generation merges: quantity fields are generation-owned, `bought`/`customNote`/manual rows are not; only unbought generated rows are pruned.
- `done` is terminal and owned by `POST /:id/complete`, like `cooked` on meal plan entries.
- `isPantryStaple` is user-owned, toggled via `PATCH /api/ingredients/:id`, and deliberately excluded from the seed's conflict-update set.
- Add `shopping_lists weekStarting desc` to the "Current orders" list.

**Verification:**
```bash
pnpm --filter @diet-app/db build
pnpm --filter @diet-app/api typecheck && pnpm --filter @diet-app/db typecheck
test-suite                       # full run, both packages
deploy --update feature "Shopping list generation from meal plans, purchase tracking, and pantry hand-off"
```
Expected: full suite green, deploy succeeds, `https://mase.fi/diet/api/health` responds.

Then: `helm roadmap status 381 done` and `helm roadmap status 382 done`.

**Commit after passing.** `[Mode: Direct]`

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: orchestrator implements directly
- Mode B tasks: Dispatched to subagents

Tasks 1 → 9 are ordered by dependency. Tasks 2 and 3 are independent of each other and may run in parallel; Task 4 is independent of both. Tasks 5–8 all depend on Task 1's migration and on Tasks 2–3.
