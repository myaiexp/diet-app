# Shopping List Generation + Writes — Design

**Roadmap:** #381 (generation from meal plan), #382 (write endpoints + purchase tracking)
**Date:** 2026-08-04
**Status:** approved

## Problem

`shopping_lists` / `shopping_list_items` exist in the schema and have exactly one
endpoint: `GET /api/shopping-lists/current`. Nothing can create a list, derive one
from the meal plan, check an item off, or record what was bought. The table is
inert.

Phase 1 shipped the two halves this feature sits between: `meal_plan_entries` know
what will be cooked and at what servings, and `pantry_items` know what is already
in the kitchen. A shopping list is the difference between them.

## Operating reality (shapes every decision below)

The user cooks reluctantly, lives alone, and does not maintain pantry data — the
concept of a stocked pantry is foreign. **The pantry table will usually be empty
or stale.**

Two consequences, both load-bearing:

1. **The feature must be useful with zero pantry rows.** With an empty pantry,
   `quantityInPantry` is 0 and `netToBuy` collapses to raw recipe demand. That is
   the expected common case, not a degraded one. It is also why this design does
   not invest in sophisticated pantry modelling (mid-week expiry simulation,
   cross-dimension density conversion) — that machinery would run against no data.
2. **`POST /:id/complete` writing bought items into the pantry is the only path by
   which pantry data ever becomes real.** Buying is the one moment stock verifiably
   enters the kitchen, and the list already knows ingredient, quantity, and unit.
   Without it the netting half of #381 is permanently dead weight.

## Scope

**In:**

- `POST /api/shopping-lists/generate` — derive a week's list from the meal plan
- List reads: `GET /`, `GET /:id` (`/current` already exists, gains item ordering)
- List writes: `PATCH /:id` (status), `DELETE /:id`
- Item writes: `POST /:id/items`, `PATCH /items/:id`, `DELETE /items/:id`
- `POST /:id/complete` — mark done, bulk-add bought items to the pantry
- `PATCH /api/ingredients/:id` — toggle `isPantryStaple` (enabling piece, see below)
- One migration; one seed fix

**Out:**

- AI-assisted list building (no AI in this feature at all)
- Store/price/aisle-layout data (idea #2550 covers Finnish grocery APIs)
- Cross-dimension conversion via ingredient density (idea #2593)
- General ingredient catalog editing beyond the staple flag
- Any frontend (#391)

## Decision 1 — items carry a unit, one row per (ingredient, dimension)

`shopping_list_items` stores `quantityNeeded` / `quantityInPantry` / `netToBuy` as
bare numerics with **no unit column**. That is unworkable for generated data:
across one week the same ingredient appears as `400 g`, `0.5 kg`, and `2 pieces`.
The first two merge to 900 g; the third is a different dimension, and `units.ts`
deliberately never crosses dimensions (no density data — the cook flow emits
`unit_mismatch` shortfalls for exactly this). A bare `900` in the DB cannot be
read back as grams or millilitres.

**Chosen:** add a `unit` column and key items on `(ingredient, dimension)`.
Chicken becomes two honest rows — `900 g` and `2 pieces`. Quantities are stored in
the dimension's base unit (`g` / `ml` / `pieces`); all 462 seeded `defaultUnit`
values are already exactly those three, so stored units match the ingredient
default in practice. Prettifying `900 g` as `0.9 kg` is the client's job.

**Rejected — one row per ingredient normalized to `defaultUnit`:** requires
dropping or stuffing the foreign-dimension line into `customNote`. A recipe line
silently disappears between the meal plan and the shop. The whole point of
generation is that it is complete.

**Rejected — no unit column, derive from `ingredient.defaultUnit` at read:** breaks
the moment an ingredient defaults to `g` but the row is a `pieces` aggregate.
Same data loss as above with more implicit coupling.

## Decision 2 — regeneration merges, never rebuilds

Generating twice is the normal case: plan the week, shop partially, swap Thursday's
dinner, regenerate. A delete-and-reinsert throws away check-offs and hand-added
rows.

**Chosen — the list is a merge target:**

- **`source` column** (`'generated' | 'manual'`, notNull). Without it there is no
  way to distinguish "the plan no longer needs this" from "the user typed this".
- **Unique index `(list_id, ingredient_id, unit)`.** Generation becomes an upsert:
  rows still in the plan have their three quantity fields rewritten in place, so
  `bought`, `customNote`, and `source` survive untouched. A manual add colliding
  with an existing row returns 409 rather than duplicating.
- **Narrow deletion:** only `source = 'generated' AND bought = false` rows absent
  from the fresh plan are removed. A generated row already bought stays even if the
  plan changed — that food was purchased, and dropping it would also drop it from
  the pantry hand-off at `/complete`.
- **Unique index `shopping_lists(week_starting)`.** `/current` picks the newest
  week ≤ today; two lists for one week makes that ambiguous. The constraint also
  turns generate's "does one already exist" check from a TOCTOU race into a unique
  violation that maps to a clean 409.
- **Regeneration only on `status = 'draft'`** → 409 otherwise. Simpler than a
  `force` flag, and it gives the non-draft statuses a meaning. This is the one
  cheap-to-reverse piece here (a single guard); the indexes and `source` are not.

**Rejected — versioned lists (generate always creates a new one):** conceptually
cleaner, but `week_starting` can no longer be unique, `/current` becomes ambiguous,
and check-offs must be hand-migrated forward anyway. Not worth it single-user.

## Decision 3 — what enters the arithmetic

**Demand.** Entries in the ISO week (Mon–Sun) bounding `weekStarting`, via the
existing `getISOWeekBounds`. Statuses `planned` and `substituted` count; the recipe
resolves as `substituteRecipeId ?? recipeId`, identical to the cook flow.

- `skipped` excluded — not being made.
- `cooked` excluded — already made, and auto-deduct already removed its ingredients
  from the pantry. Counting it would double-buy. Demand and supply stay consistent:
  a mid-week regeneration sees the post-deduction pantry *and* skips the entry that
  caused the deduction.
- Entries with no recipe (freeform note only) contribute nothing.
- Each line scales by `entry.servings / recipe.servings`.

**Optional recipe lines are excluded.** `cook-deduct` already treats them as
non-shortfall; an optional garnish should not send anyone to the shop. An
`includeOptional` flag is filed as a deferred idea.

**Supply.** Pantry rows for the ingredient whose unit resolves to the *same
dimension*, summed in base units, **excluding rows already expired as of today** —
that food is going in the bin, and counting it under-buys.

Mid-week expiry is deliberately not modelled: a yoghurt that dies Wednesday still
counts against Saturday's demand. Pricing that correctly needs per-day simulation,
which is a different feature — and with a near-empty pantry it would almost never
fire.

> **Superseded (2026-08-21, idea #3230).** Per-day simulation shipped once the
> shopping screen made `/complete` — the thing that actually populates the pantry —
> reachable. Demand is now keyed `(ingredient, dimension, date)` and the week is
> walked chronologically, consuming lots FEFO with an availability date of
> `max(entryDate, today)`. The paragraph above describes the original behaviour
> only. It also changed what `quantityInPantry` means (coverage of this week's
> demand, capped at `quantityNeeded` — not raw stock); see CLAUDE.md.

**Net.** `netToBuy = max(0, needed - inPantry)`, rounded to 6 decimals like
`cook-deduct`. Rows where `netToBuy` is 0 are **kept**, not dropped —
`quantityInPantry` showing full coverage is useful information, and keeping them
means regeneration rewrites such a row rather than deleting one the user may have
ticked.

## Decision 4 — staples are user-curated, grouped, never dropped

The original `2026-03-05-project-init-design.md` says `is_pantry_staple` "skips
tracking + shopping list". That rule is wrong against the seeded data: 35
ingredients carry the flag and they mix genuinely-never-runs-out items (salt,
cumin, baking soda, vinegar, oils, stock cubes) with things plainly bought at the
shop (potato, onion, garlic, lemon, butter, white rice, oats, flour). Excluding
them means the list never once says to buy potatoes.

**Chosen: the classification is a user preference, not a property of the
ingredient — and not hardcoded in seed data.**

- Generation treats staples **identically** to everything else. They become real
  rows.
- Reads sort them last: non-staples first, then `category` **alphabetically** (a
  plain `asc` — there is no curated aisle sequence and none is proposed; grouping
  by category is what the denormalized `category` column on the item is for), then
  ingredient name, then id. The buy-list reads first; the assumed-on-hand tail sits
  underneath.
- The flag is **not** denormalized onto the item row the way `category` is.
  `category` is stable; this flag is *designed* to be toggled, so a snapshot would
  go stale. It is read live through the ingredient join.
- Seed classifications are left exactly as they are. They are a starting guess,
  one toggle each to fix.

Grouping rather than filtering is deliberate: the flag has already been observed
mis-set once, and a wrong flag should put an ingredient in the **wrong group**
(visible, one tap to fix) rather than make it **vanish** (invisible, discovered
while cooking).

### Two enabling changes this forces

**1. `PATCH /api/ingredients/:id`.** Ingredients are read-only today (`GET /`,
`GET /:id`). A flag the user is meant to curate needs a write path. Scoped to
`{ isPantryStaple }` only; general catalog editing is a separate feature.

**2. The seed must stop overwriting it.** `seedDatabase` upserts on `name`, and its
`ON CONFLICT DO UPDATE` set list includes `isPantryStaple: excluded.is_pantry_staple`
(`seed-core.ts:68`). Every `pnpm db:seed` — the idempotent refresh path, re-run
whenever ingredient data is regenerated — would reset all 462 flags to the JSON
values and silently wipe the user's curation. **Drop `isPantryStaple` from that
conflict-update set.** The insert still seeds an initial guess for new ingredients;
a re-seed no longer fights the user. Every other column there (aliases, category,
nutrition, shelf life, tags) is genuine catalog data and must keep refreshing.

This is a live data-loss bug the moment the flag becomes user-owned, so it is not
optional cleanup — it ships with this feature.

## Decision 5 — `/complete` writes the pantry; three statuses, not four

**Status lifecycle: `draft → shopping → done`.** The init doc also lists
`finalized`, but once regeneration gates on `draft`, `finalized` and `shopping`
both just mean "locked". A status that does nothing is a status that drifts.

**`done` is reachable only via `POST /:id/complete`** — `PATCH /:id` can neither
set it nor leave it. This mirrors `cooked` on meal plan entries exactly, and for
the same reason: the transition has side effects (pantry writes) that a plain
status flip would skip, and terminality is what makes double-add impossible.
Completing an already-`done` list returns 409.

**What complete does,** in one transaction:

For every item with `bought = true` and `netToBuy > 0`:

- `quantity` = `netToBuy`, `unit` = the item's unit
- `location` = inferred from the item's `category`
  (produce / dairy / protein → `fridge`, frozen → `freezer`,
  grain / spice / condiment / other → `pantry`), overridable per item in the
  request body
- `addedDate` = today; `expiresDate` = `resolveExpiresDate(shelfLife, location, addedDate)`

Items whose expiry cannot be resolved (no shelf-life entry for the inferred
location) are **skipped and reported**, not fatal. Response shape mirrors the cook
flow's `{ deductions, shortfalls }`:

```json
{ "list": { … }, "added": [ … ], "skipped": [ { "itemId": "…", "reason": "no_shelf_life" } ] }
```

A partial completion that tells you what it could not file is better than a 400
that files nothing.

**Deleting a `done` list returns 409.** A completed list is the only record of a
purchase; it is not erasable by accident. Consistent with `cooked` being terminal.

## Architecture

### Pure modules (no DB, unit-testable in isolation)

Mirrors the `cook-deduct.ts` precedent — all arithmetic lives outside the route.

| Module | Responsibility |
| --- | --- |
| `shopping-aggregate.ts` | Meal plan entries + recipes + lines + pantry rows → item specs. Demand aggregation, dimension grouping, pantry netting. |
| `pantry-location.ts` | Ingredient category → default storage location. |
| `shopping-sort.ts` | Item ordering: non-staple, category, name, id. |
| `units.ts` (extend) | `baseUnit(dimension)` → `'g' \| 'ml' \| 'pieces'`. |

`shopping-aggregate` signature:

```ts
export function aggregateShoppingList(input: {
  entries: PlanEntry[];        // id, recipeId, substituteRecipeId, servings, status
  recipesById: Map<string, { servings: number }>;
  linesByRecipe: Map<string, RecipeLine[]>;
  pantryRows: PantrySupplyRow[];
  ingredientsById: Map<string, { category: string }>;
  today: string;               // YYYY-MM-DD
}): { items: GeneratedItem[]; skipped: SkippedLine[] };
```

`skipped` carries lines that could not be aggregated (`unknown_unit`,
`recipe_missing`, `bad_scale`) so a dropped line is reported rather than silent —
the same contract as cook's shortfalls.

### Route modules

Split to stay under the 300-line rule and keep one concern per file:

| File | Endpoints |
| --- | --- |
| `routes/shopping-lists.ts` | `GET /`, `GET /current`, `GET /:id`, `PATCH /:id`, `DELETE /:id`; mounts the sub-routers |
| `routes/shopping-list-generate.ts` | `POST /generate` |
| `routes/shopping-list-items.ts` | `POST /:id/items`, `PATCH /items/:id`, `DELETE /items/:id` |
| `routes/shopping-list-complete.ts` | `POST /:id/complete` |
| `routes/ingredients.ts` (edit) | adds `PATCH /:id` to the existing read-only router |
| `schemas/shopping-lists.ts` | Zod bodies |
| `schemas/ingredients.ts` | Zod body for the ingredient PATCH |

`GET /` is an unbounded, ever-growing collection (one row per week), so it follows
the project's list convention: `getPagination(c)` plus
`.orderBy(desc(weekStarting), asc(id))` — newest week first, id tie-break
mandatory. `CLAUDE.md`'s "Current orders" list gains this entry.

**Hono routing note:** `/current` and `/generate` are single-segment literals that
collide with `/:id` and must register first. `/items/:id` is two segments and does
not collide with the one-segment `/:id`, but literals-first is the rule to follow
regardless.

### Data flow — generate

```
POST /generate { weekStarting }
  → snap to ISO Monday (getISOWeekBounds)
  → BEGIN
      SELECT list WHERE week_starting = monday FOR UPDATE
        exists && status != 'draft'  → 409
        missing                      → INSERT (unique violation → 409)
      load: entries [monday..sunday], recipes, recipe_ingredients, pantry rows, ingredients
      aggregateShoppingList(...)                       ← pure
      UPSERT items ON (list_id, ingredient_id, unit)   ← rewrites quantities only
      DELETE generated ∧ ¬bought ∧ absent-from-plan
    COMMIT
  → 200 { list, items, skipped }
```

### Data flow — complete

```
POST /:id/complete { overrides?: [{ itemId, location }] }
  → BEGIN
      SELECT list FOR UPDATE ; status == 'done' → 409
      SELECT items WHERE bought ∧ net_to_buy > 0, JOIN ingredients
      for each: location = override ?? locationForCategory(category)
                expiresDate = resolveExpiresDate(shelfLife, location, today)
                  null → skipped, continue
                INSERT pantry_items
      UPDATE list SET status = 'done'
    COMMIT
  → 200 { list, added, skipped }
```

### Item write contract

**`POST /:id/items`** — a manual addition ("coffee filters", "something for
Sunday").

| Field | Required | Notes |
| --- | --- | --- |
| `ingredientId` | yes | uuid; unknown → 400 `Invalid reference` |
| `quantityNeeded` | yes | positive number |
| `unit` | yes | must resolve via `resolveUnit`; unknown → 400 |
| `customNote` | no | free text |

Server-derived, never client-supplied: `category` (read from the ingredient, the
same way `POST /pantry` derives `expiresDate` from the ingredient's shelf life),
`source = 'manual'`, `bought = false`.

**The submitted unit is normalized to its dimension's base before writing** — a
manual `1 kg` is stored as `1000 g`. This is not cosmetic: the unique index is
`(list_id, ingredient_id, unit)`, so an un-normalized `kg` row would sit alongside
a generated `g` row for the same ingredient instead of colliding with it, and the
duplicate protection would quietly do nothing.

**No pantry netting on manual rows:** `quantityInPantry = 0`, `netToBuy =
quantityNeeded`. The user typed what they want to buy, and silently reducing it
against pantry stock would contradict them. Regeneration never touches manual rows,
so a netted value could never be refreshed either — a permanently stale number is
worse than an absent one.

**`PATCH /items/:id`** — strict, non-empty, accepting `bought`, `quantityNeeded`,
`netToBuy`, `customNote`.

Not editable: `ingredientId`, `unit`, `listId`, `source`, `category`. Changing the
first two would move the row across the unique index; delete and re-add instead.

Two consequences of the merge model that the plan must document rather than
prevent:

- Editing `quantityNeeded` / `netToBuy` on a `source='generated'` row is
  **overwritten by the next regeneration** — those three quantity fields are
  generation-owned. `bought` and `customNote` are not, and always survive. Manual
  rows are never rewritten at all.
- `DELETE /items/:id` on a generated row removes it **until the next
  regeneration**, which will bring it back because the plan still calls for it.
  Regeneration is explicit and infrequent, so this is acceptable; the alternative
  (a tombstone marker suppressing a plan-derived ingredient indefinitely) is more
  machinery than the annoyance justifies.

## Migration

Single drizzle-kit migration:

```sql
ALTER TABLE shopping_list_items ADD COLUMN unit text NOT NULL;
ALTER TABLE shopping_list_items ADD COLUMN source text NOT NULL DEFAULT 'generated';
ALTER TABLE shopping_list_items ALTER COLUMN bought SET DEFAULT false;
ALTER TABLE shopping_list_items ALTER COLUMN bought SET NOT NULL;
CREATE UNIQUE INDEX ON shopping_list_items (list_id, ingredient_id, unit);
CREATE UNIQUE INDEX ON shopping_lists (week_starting);
```

`bought` is currently `boolean().default(false)` and therefore nullable; the
"unbought generated rows" delete predicate would miss NULLs. Making it notNull
closes that.

**Adding `unit` as NOT NULL without a default fails if rows exist.** No endpoint has
ever written to this table, so it should be empty — the plan must verify with
`SELECT count(*) FROM shopping_list_items` before migrating, and backfill first if
that assumption is wrong.

## Error handling

Reuses the shared helpers in `responses.ts` throughout; no inline `{ error }` bodies.

| Condition | Response |
| --- | --- |
| Malformed `:id` | 400 `Invalid id format` (`isUuid` before any query) |
| Bad/empty JSON body | 400 via `parseJsonBody` |
| List / item not found | 404 |
| Regenerate a non-draft list | 409 |
| Duplicate list for a week (race) | 409 (unique violation on `week_starting`) |
| Manual add duplicating an existing (ingredient, unit) | 409 (unique violation) |
| `PATCH /:id` setting or leaving `done` | 409 |
| Complete an already-done list | 409 |
| Delete a done list | 409 |
| Unknown `ingredientId` | 400 `Invalid reference` (`isFkViolation`) |
| Item skipped during aggregation / completion | 200, reported in `skipped` |

Route `catch` blocks map known PG codes via `pg-errors.ts` and `throw err`
afterwards so unknown errors still reach Hono's `onError`.

## Testing

**Pure-module unit tests** (no DB, no mocks):

- `shopping-aggregate.test.ts` — multi-recipe aggregation; two dimensions for one
  ingredient producing two rows; servings scaling; optional lines excluded;
  `cooked` and `skipped` entries excluded; substitute recipe wins; freeform entries
  contribute nothing; expired pantry rows excluded from supply; unknown units land
  in `skipped`; `netToBuy` floored at 0
- `pantry-location.test.ts` — every seeded category maps; unknown category falls
  back to `pantry`
- `shopping-sort.test.ts` — non-staples precede staples, then aisle, then name, id
- `units.test.ts` — `baseUnit` for each dimension

**Mock route tests** via `__tests__/db-mock.ts` + `select-router.ts` (dispatch
fixtures by table, never by call order):

- generate: creates a list; regenerates preserving `bought` and manual rows;
  deletes only unbought generated rows; 409 on non-draft
- items: manual add sets `source='manual'` and derives `category` from the
  ingredient; a `kg` add normalizes to `g` and therefore 409s against an existing
  generated row; PATCH toggles `bought`; PATCH rejects `unit`/`ingredientId`;
  DELETE 204
- complete: inserts pantry rows for bought items; unresolvable expiry reported in
  `skipped`; 409 when already done
- status: PATCH cannot set or leave `done`

**Integration tests** (`routes.test.ts`, real `dietapp_test` DB) — the round trip
that mocks cannot prove: seed a meal plan → generate → tick items → add a manual
row → regenerate and assert both survived → complete → assert real `pantry_items`
rows exist with correct expiry.

**Regression test in `seed-core.test.ts`:** toggle `isPantryStaple`, re-run the
seed, assert the toggle survived. This is the test that would have caught the bug
above, and the one that keeps it fixed.

Note for the plan: the existing `makeMockDb` in that suite captures only
`onConflictTarget`, not the `set` object, so it currently **cannot observe** whether
a column appears in the conflict-update list. The mock needs extending to capture
`set` (preferred — keeps the test fast and hermetic), or the assertion moves to a
real-DB integration test. Writing the test against today's mock would produce one
that passes whether or not the bug is fixed.

## Documentation

`CLAUDE.md` gains: the item unit/dimension rule, regeneration merge semantics, the
`done`-is-complete-owned invariant, and the note that `isPantryStaple` is
user-owned and deliberately excluded from the seed's conflict-update set.

## Implementation order

1. Migration + schema changes + seed fix (+ its regression test)
2. Pure modules + their tests
3. `PATCH /api/ingredients/:id`
4. `POST /generate` (#381)
5. Read endpoints + item writes + status PATCH (#382)
6. `POST /:id/complete` (#382)
7. Integration tests, docs, deploy
