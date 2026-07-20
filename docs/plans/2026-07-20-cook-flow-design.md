# Cook Flow Design — Meal Plan Writes, Auto-Deduct, Cook Feedback

**Date:** 2026-07-20
**Status:** Approved
**Roadmap:** #379 (meal plan POST/PATCH/DELETE), #241 (auto-deduct on cook), #377 (cook feedback endpoints)

## Problem

`meal_plan_entries` has read-only coverage (`GET /api/meal-plans/week/:date`). Nothing can create an entry, transition its `status`, or record what happened after cooking. That blocks #241 (auto-deduct on cook), which is the mechanism that keeps pantry data trustworthy — without it the pantry goes stale and every downstream feature (shopping lists, spoilage-first suggestions) degrades.

These three roadmap items are one flow, not three features: `cook_feedback.meal_plan_entry_id` is `NOT NULL UNIQUE`, so feedback is inseparable from the cook event, and the cook event is unreachable without entry writes.

## Goals

- Ship meal plan entry create/update/delete matching the project-init API design.
- Mark an entry cooked and deduct the recipe's ingredients from the pantry, spoilage-first.
- Record and read 1:1 cook feedback per entry.
- Keep the deduction logic pure and DB-free so it is exhaustively unit-testable.

## Non-goals

- `POST /meal-plans/generate` (AI week generation — #387, Phase 3)
- Any schema migration or new column (`actual_servings`, waste log, unit preferences)
- Unit-preference / quantity learning (#390), waste reporting (#389)
- Shopping list interaction (#381) — cooking does not touch shopping lists
- Re-stocking on un-cook: reverting `status` from `cooked` does **not** restore pantry quantities (see Alternatives)

## Current baseline (verified)

| Surface | State |
| ------- | ----- |
| `GET /api/meal-plans/week/:date` | Shipped; `isIsoDate` guard + `getISOWeekBounds`, no pagination (bounded by week) |
| `routes/meal-plans.ts` | 27 lines, single GET handler |
| Write precedent | `routes/pantry.ts` and `routes/recipes.ts` (#236/#237) — Zod schemas under `schemas/`, `readJsonBody`, `notFound`/`badRequest`/`conflict`, `isUuid` path guard, `db.transaction` for multi-table writes |
| Pure-helper precedent | `pantry-status.ts` (`computeStatus`), `pantry-expiry.ts` (`resolveExpiresDate`) — no I/O, directly unit-tested |
| `recipes.timesCooked` | Column exists (`notNull default 0`); **no code writes it today** |
| Seed units | `ingredients.defaultUnit` is only ever `g` (376), `ml` (59), `pieces` (27) |
| `recipe_ingredients.unit` / `pantry_items.unit` | Free text, `notNull` — no enum, no normalization anywhere yet |
| FKs | `cook_feedback → meal_plan_entries` and `meal_plan_entries → recipes` are NO ACTION (no cascade) |

## Vocabulary (from `2026-03-05-project-init-design.md`)

These are **not** newly invented; the architecture doc fixes them and this design adopts them verbatim.

| Field | Values |
| ----- | ------ |
| `meal_plan_entries.slot` | `breakfast` \| `lunch` \| `dinner` \| `snack` |
| `meal_plan_entries.status` | `planned` \| `cooked` \| `skipped` \| `substituted` |
| `cook_feedback.rating` | `thumbs_up` \| `thumbs_down` |
| `cook_feedback.effort_check` | `felt_right` \| `too_hard` \| `too_easy` |
| `cook_feedback.make_again` | `yes` \| `maybe` \| `no` |

## Architecture

The deduction algorithm is a pure function with no database access. The route loads rows, calls the planner, and applies the result in a transaction. This keeps the branchy part (unit conversion, FEFO ordering, partial fills, shortfalls) testable without a DB, matching the `pantry-status.ts` precedent.

| File | Responsibility | New? |
| ---- | -------------- | ---- |
| `packages/api/src/units.ts` | Unit normalization: `toBase`, `fromBase`, dimension families | new |
| `packages/api/src/cook-deduct.ts` | `planDeduction(lines, pantryRows, scale)` → deductions + shortfalls. Pure | new |
| `packages/api/src/schemas/meal-plans.ts` | Zod: entry create/patch, feedback create/patch | new |
| `packages/api/src/routes/meal-plans.ts` | Existing week GET + POST/PATCH/DELETE; mounts the two sub-routers | edit |
| `packages/api/src/routes/meal-plan-cook.ts` | `POST /:id/cook` | new |
| `packages/api/src/routes/meal-plan-feedback.ts` | `GET`/`POST`/`PATCH /:id/feedback` | new |

Sub-routers mount onto the same Hono app (`app.route('/', cookRoutes(db))`), so `app.ts` wiring is unchanged and no file approaches the 300-line limit.

## Unit conversion (`units.ts`)

Recipe lines and pantry rows both store free-text units, so a recipe calling for `500 g` must deduct from a pantry row holding `1 kg`. Three dimensions, each with a canonical base:

| Dimension | Base | Accepted units → factor |
| --------- | ---- | ----------------------- |
| mass | `g` | `mg` 0.001, `g` 1, `kg` 1000 |
| volume | `ml` | `ml` 1, `cl` 10, `dl` 100, `l` 1000, `tsp`/`tl` 5, `tbsp`/`rkl` 15 |
| count | `pieces` | `piece`/`pieces`/`pcs`/`kpl` 1 |

- Lookup is case-insensitive and trimmed (`" KG "` → mass).
- Finnish forms (`kpl`, `rkl`, `tl`, `dl`) are included deliberately — this is a Finnish-language app and those are what recipe text actually contains.
- An unrecognized unit returns `null` (not a throw); callers treat it as unconvertible.
- **Cross-dimension conversion is never attempted.** `g` ↔ `ml` requires a per-ingredient density that the schema does not carry. A recipe line and pantry row in different dimensions produce a `unit_mismatch` shortfall and **zero deduction** — a wrong subtraction is worse than none, because it silently corrupts inventory.

```ts
type Dimension = 'mass' | 'volume' | 'count';
toBase(quantity: number, unit: string): { dimension: Dimension; value: number } | null
fromBase(value: number, unit: string): number | null   // base value → that unit's scale
```

## Deduction planner (`cook-deduct.ts`)

```ts
planDeduction(
  lines: RecipeLine[],        // { ingredientId, quantity, unit, optional }
  pantryRows: PantryRow[],    // { id, ingredientId, quantity, unit, expiresDate, opened, createdAt }
  scale: number,              // entry.servings / recipe.servings
): { deductions: Deduction[]; shortfalls: Shortfall[] }
```

**Per recipe line:**

1. `needed = line.quantity * scale`, converted to its dimension's base. Unconvertible line unit → `unit_mismatch` shortfall, no deduction.
2. Collect that ingredient's pantry rows whose unit resolves to the **same dimension**. Rows in another dimension are skipped and, if nothing else covers the line, reported as `unit_mismatch`.
3. Sort **FEFO**: `expiresDate` ascending, then `opened` first, then `createdAt` ascending. Spoilage-first is the app's founding principle; this is where it becomes behavior rather than a slogan.
4. Walk the sorted rows, consuming from each until `needed` is satisfied. Each touched row yields a deduction carrying its new quantity **expressed in that row's own unit** (converted back via `fromBase`) — a row stored in `kg` stays in `kg`.
5. Residual below `1e-9` counts as zero: the line is satisfied, and any row whose remainder falls under that epsilon is marked for deletion.
6. Leftover `needed` after all rows → shortfall.

**Shortfall reasons:** `not_in_pantry` (no rows at all), `insufficient_stock` (rows existed, ran out), `unit_mismatch` (rows existed but no compatible dimension).

**Optional lines** (`recipe_ingredients.optional = true`) are deducted opportunistically — whatever is in stock is consumed, and they **never** generate a shortfall. The user cooked the dish; whether they used the optional parsley is not an inventory error.

Quantities are rounded to 6 decimal places before being written back, so float residue (`0.30000000000000004`) never reaches the database.

## API contracts

Shared conventions are inherited unchanged from #236/#237: Bearer auth on all `/api/*` except health; `isUuid(id)` → `400 { error: 'Invalid id format' }` before any query; non-JSON body → `400 { error: 'Invalid JSON body' }`; Zod failure → `400 { error: 'Validation failed', details: z.flattenError(error) }`; missing row → `404 { error: 'Not found' }`; Postgres `23503` → `400 { error: 'Invalid reference' }`.

### #379 `POST /api/meal-plans`

| Field | Required | Notes |
| ----- | -------- | ----- |
| `date` | yes | ISO `YYYY-MM-DD` (`isIsoDate`) |
| `slot` | yes | slot enum |
| `recipeId` | conditional | UUID; must exist |
| `freeformNote` | conditional | Non-empty string ("lunch at restaurant") |
| `servings` | no | Positive number, default `1` |
| `status` | no | status enum, default `planned` |
| `substituteRecipeId` | no | UUID; must exist |
| `notes` | no | Nullable string |

Cross-field: **at least one of `recipeId` or `freeformNote`** — an entry naming neither a recipe nor a meal is meaningless. Zod `refine`, message surfaced in `formErrors`.

Cross-field consistency beyond the two rules stated in this document (the content rule above, and the `usedAsIs`/`changesNote` rule for feedback) is **out of scope**. In particular, setting `substituteRecipeId` does **not** require or imply `status: 'substituted'`, and `date` is not validated against the current week.

No uniqueness on `(date, slot)`: multiple snacks per day are normal, and enforcing it would require a migration for no benefit.

**Success:** `201` with the inserted row. `servings` reads back as a string (Drizzle `numeric` shape), consistent with pantry `quantity`.

### #379 `PATCH /api/meal-plans/:id`

Partial update of `date`, `slot`, `recipeId`, `freeformNote`, `servings`, `status`, `substituteRecipeId`, `notes`. `.strict()`; empty patch → `400`. Nullable columns (`recipeId`, `freeformNote`, `substituteRecipeId`, `notes`) accept explicit `null` to clear. Bumps `updatedAt`.

**The content rule is re-checked against the merged result** (existing row + patch), not the patch alone — otherwise clearing whichever of `recipeId` / `freeformNote` currently holds the entry's content would leave both null, producing exactly the meaningless state POST rejects. Violation → `400 { error: 'Validation failed' }` with the same message as POST.

**`cooked` is owned exclusively by `POST /:id/cook`.** Two guards, both `409`:

| PATCH attempt | Result |
| ------------- | ------ |
| Sets `status: 'cooked'` on a non-cooked entry | `409 { error: 'Use POST /meal-plans/:id/cook to mark an entry cooked' }` |
| Changes `status` on an entry already `cooked` | `409 { error: 'Cooked meal plan entry status is immutable' }` |

A no-op `status: 'cooked'` on an already-cooked entry is accepted, and every other field on a cooked entry stays patchable (notes, servings, …). `planned` ↔ `skipped` ↔ `substituted` move freely.

Together these make `cooked` a terminal state reachable only through the deducting code path, which is what makes the cook guard in `POST /:id/cook` actually sound. Without them, `cook` → `PATCH { status: 'planned' }` → `cook` is a fully documented API sequence that deducts the same meal from the pantry twice, and `PATCH { status: 'cooked' }` is a way to reach the cooked state with no deduction at all. The alternative — a durable per-cook deduction record the guard could consult — needs a new table, which this slice deliberately does not take on. Correcting a mistakenly cooked entry therefore means deleting it (feedback first) and recreating; the deducted quantities are not restored either way, consistent with the un-cook non-goal.

**Success:** `200` updated row. Missing → `404`.

### #379 `DELETE /api/meal-plans/:id`

If a `cook_feedback` row references the entry → `409 { error: 'Meal plan entry has cook feedback' }`. Cooking history must not vanish silently (same reasoning as the recipe-delete guard in #237). Otherwise hard delete → `204`. Missing → `404`. Deleting a cooked entry does **not** restore deducted pantry quantities.

### #241 `POST /api/meal-plans/:id/cook`

No request body (see Alternatives — servings override). Everything happens in one transaction:

1. `SELECT ... FOR UPDATE` the entry. Missing → `404`. `status === 'cooked'` → **`409 { error: 'Meal plan entry already cooked' }`** — the idempotency guard. It is only sound because PATCH cannot move an entry out of `cooked` (see above); the two rules have to be implemented together.
2. Resolve the recipe as `substituteRecipeId ?? recipeId`. If both are null (freeform entry), skip to step 6 with empty results.
3. Load the recipe (for `servings`) and its ingredient lines; load every `pantry_items` row for those ingredient ids `FOR UPDATE`. Row-locking closes the read-then-write race between concurrent cooks.
4. `scale = Number(entry.servings) / recipe.servings` (recipe `servings` is `notNull default 1`, so no divide-by-zero). Call `planDeduction`.
5. Apply: update each touched pantry row's `quantity` + `updatedAt`; delete rows that reached zero; `timesCooked = timesCooked + 1` on the resolved recipe.
6. Set `status = 'cooked'`, bump `updatedAt`. Commit.

**Success:** `200`

```jsonc
{
  "entry": { /* updated meal_plan_entries row */ },
  "deductions": [
    { "ingredientId": "…", "requested": 500, "deducted": 500, "dimension": "mass",
      "pantryItems": [ { "id": "…", "unit": "kg", "before": "1", "after": "0.5", "deleted": false } ] }
  ],
  "shortfalls": [
    { "ingredientId": "…", "requested": 200, "available": 50,
      "dimension": "mass", "reason": "insufficient_stock" }
  ]
}
```

Shortfalls are reported, never fatal — refusing to record a meal the user has already cooked would be wrong, and the shortfall data is exactly what #390 (quantity learning) will consume later.

### #377 `POST /api/meal-plans/:id/feedback`

| Field | Required | Notes |
| ----- | -------- | ----- |
| `rating` | yes | rating enum |
| `effortCheck` | yes | effort enum |
| `makeAgain` | yes | make-again enum |
| `usedAsIs` | yes | Boolean |
| `changesNote` | conditional | Non-empty string **required when `usedAsIs === false`**; must be absent/null when `true` |

The conditional mirrors the intended interaction ("Used recipe as-is?" → Yes / "Made changes" → what changed?) from the features doc.

- Entry missing → `404`. Entry `status !== 'cooked'` → `409 { error: 'Meal plan entry is not cooked' }` — feedback about an uncooked meal is nonsense.
- Feedback already exists → `409 { error: 'Feedback already exists for this meal plan entry' }` (the column is `UNIQUE`; also catch `23505` as a race backstop).
- **Success:** `201` with the created row.

### #377 `GET /api/meal-plans/:id/feedback`

`200` with the row, `404` when the entry or the feedback is absent.

### #377 `PATCH /api/meal-plans/:id/feedback`

Partial update, `.strict()`, empty patch → `400`. The `usedAsIs`/`changesNote` rule is enforced against the **merged** result (existing row + patch), not the patch alone — otherwise flipping `usedAsIs` to `false` alone would leave a note-less "made changes" record. `200` updated row; missing feedback → `404`.

## Error response shapes

```
400 { error: 'Validation failed', details: <zod flatten> }
400 { error: 'Invalid JSON body' }
400 { error: 'Invalid id format' }
400 { error: 'Invalid date format' }                                  // existing week route
400 { error: 'Invalid reference' }                                    // FK 23503
404 { error: 'Not found' }
409 { error: 'Meal plan entry already cooked' }
409 { error: 'Meal plan entry is not cooked' }
409 { error: 'Use POST /meal-plans/:id/cook to mark an entry cooked' }
409 { error: 'Cooked meal plan entry status is immutable' }
409 { error: 'Feedback already exists for this meal plan entry' }
409 { error: 'Meal plan entry has cook feedback' }
204 (no body)  |  201 / 200 (resource JSON)
```

## Testing strategy

### Unit — pure modules (no mocks, real assertions)

`units.ts`: each family round-trips; `kg`→`g` ×1000; `dl`→`ml` ×100; Finnish `rkl`/`tl`/`kpl`; case and whitespace tolerance; unknown unit → `null`; cross-dimension pairs never resolve to a shared dimension.

`cook-deduct.ts`: exact single-row match; cross-unit match (recipe `g`, pantry `kg`); multi-row FEFO order (soonest expiry consumed first, opened-before-unopened tiebreak); partial fill spanning two rows; `insufficient_stock` remainder; `not_in_pantry`; `unit_mismatch` (mass line vs count row) yields zero deduction; optional line never produces a shortfall; `scale` ≠ 1 (half and double servings); row reduced to exactly zero is marked deleted; float residue below epsilon is treated as zero, not a `1e-17` leftover.

### Unit — routes (mock DB, existing `select-mock.ts` pattern)

POST entry: valid → 201; neither `recipeId` nor `freeformNote` → 400; bad slot → 400. PATCH: partial ok; empty body → 400; unknown key → 400; 404; **clearing the only content field (merged result has neither `recipeId` nor `freeformNote`) → 400**; **`status: 'cooked'` → 409**; **any status change on a cooked entry → 409**; no-op `status: 'cooked'` on a cooked entry → 200. DELETE: 204; 409 with feedback; 404. Cook: 404; 409 when already cooked; freeform entry → 200 with empty deductions. Feedback: 409 when entry not cooked; `usedAsIs:false` without `changesNote` → 400; duplicate → 409; PATCH flipping `usedAsIs` to `false` with no stored or supplied `changesNote` → 400.

### Integration (`routes.test.ts`, gated on `TEST_DATABASE_URL`)

Resolve a real `ingredientId` from seeded data (never hardcode UUIDs). Create recipe (1 line, known unit) → create pantry stock covering it → create meal plan entry → `POST /cook` → **assert the pantry row's quantity actually dropped and `recipes.timesCooked` incremented** → `POST /feedback` → `GET /feedback` → second `POST /cook` returns 409. Clean up every created row in `finally`.

The cook assertion is the one that matters: it is the only test proving the whole chain moved real inventory, rather than that the planner returns a plausible object.

## Alternatives considered

| Option | Decision |
| ------ | -------- |
| Strict same-string unit matching | **Rejected** — dimension families. `500 g` from a `1 kg` bag is the normal case, not an edge case |
| Convert across dimensions via a density table | **Rejected** — no density data in the schema; guessing corrupts inventory silently. `unit_mismatch`, zero deduction |
| Normalize every quantity to the ingredient's `defaultUnit` on write | **Rejected** — a lossy rewrite of user input; conversion at read time is reversible |
| Deduct oldest-added first (FIFO) | **Rejected** — FEFO (soonest-expiring) directly serves the spoilage-first principle |
| Keep zero-quantity pantry rows | **Rejected** — breaks the `quantity > 0` invariant POST /pantry enforces and pollutes #381's shopping math. Delete them |
| `{ servings }` override in the cook body | **Rejected** — would either discard the planned value #390 needs or force an `actual_servings` migration now. `PATCH` the entry first; one source of truth |
| Block the cook on insufficient stock (409) | **Rejected** — refuses to record something that already happened. Deduct to zero and report the shortfall |
| Restore quantities when un-cooking (`status` back to `planned`) | **Rejected** — needs a deduction audit log to be correct; guessing would inflate inventory. Out of scope. Instead `cooked` is made terminal via the PATCH guards |
| Let PATCH move `status` freely and detect re-cooks another way | **Rejected** — the only durable signal is a per-cook deduction record, i.e. a new table. `cooked` as a terminal state costs nothing and closes the double-deduct path today |
| `POST /recipes/:id/feedback` (roadmap #377 wording) | **Rejected** — `cook_feedback` keys on `meal_plan_entry_id`, not `recipe_id`. Feedback is about one cooking event. Roadmap item text to be corrected |
| Upsert semantics on `POST /feedback` | **Rejected** — the `UNIQUE` constraint makes create/amend genuinely distinct. POST creates (409 on repeat), PATCH amends |
| Cascade-delete feedback with the entry | **Rejected** — 409, consistent with the recipe-delete guard |
| Unique constraint on `(date, slot)` | **Rejected** — multiple snacks per day; would need a migration |

## Implementation notes for the plan phase

- Numeric columns read back as strings — `Number(entry.servings)` before arithmetic, `String(n)` on write, matching the pantry `quantity` convention.
- `FOR UPDATE` via Drizzle `.for('update')` inside `db.transaction`.
- `recipes.servings` is `notNull default 1`; still guard `scale` against a non-finite result.
- Do not change schema or migrations in this work.
- Mark roadmap #379, #241, #377 done only after targeted tests + `build-lock tsc --noEmit` pass and `deploy` succeeds.
- ~~Correct #377's roadmap wording (it names `POST /recipes/:id/feedback` and an `actual_servings` column that the schema does not have).~~ Done 2026-07-20 via `helm roadmap update 377`.

## Approval

Approved 2026-07-20: dimension-family unit conversion with no cross-dimension guessing, FEFO deduction, shortfalls reported rather than blocking, zero-quantity rows deleted, no cook-time servings override, feedback gated on a cooked entry.

Spec review (2026-07-20) found two defects, both fixed above: the cook idempotency guard was unsound because PATCH could move `status` out of `cooked` and re-trigger a deduction (fixed by making `cooked` terminal and PATCH-unreachable), and PATCH did not re-check the `recipeId`/`freeformNote` content rule against the merged result (fixed). The reviewer verified the baseline table, vocabulary, seed-unit counts, and schema claims against live code with no discrepancies.
