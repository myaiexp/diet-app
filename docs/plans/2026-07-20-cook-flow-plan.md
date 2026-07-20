# Cook Flow Implementation Plan

**Goal:** Ship meal plan entry writes, auto-deduct of pantry stock when a meal is marked cooked, and 1:1 cook feedback — roadmap #379, #241, #377.

**Architecture:** The deduction algorithm is a pure function (`cook-deduct.ts`) over plain rows, backed by a pure unit-conversion module (`units.ts`); routes load rows, call the planner, and apply the result inside one transaction with `FOR UPDATE` row locks. Meal plan routes follow the existing #236/#237 write pattern (Zod schemas under `schemas/`, `readJsonBody`, `notFound`/`badRequest`/`conflict`, `isUuid` path guard), with cook and feedback split into their own route modules mounted onto the meal-plans Hono app so no file approaches 300 lines.

**Tech Stack:** Hono 4, Drizzle ORM 0.45, Zod 4, Postgres, Vitest 4, pnpm workspace.

**Spec:** `docs/plans/2026-07-20-cook-flow-design.md` — read it first; it is the contract. This plan does not restate its rationale.

---

## File Structure

| File | Responsibility | Task |
| ---- | -------------- | ---- |
| `packages/api/src/units.ts` | Unit → dimension/base conversion. Pure, no I/O | 1 |
| `packages/api/src/__tests__/units.test.ts` | Conversion table coverage | 1 |
| `packages/api/src/cook-deduct.ts` | `planDeduction` — FEFO consumption plan + shortfalls. Pure, no I/O | 2 |
| `packages/api/src/__tests__/cook-deduct.test.ts` | Planner behavior (the real spec) | 2 |
| `packages/api/src/schemas/meal-plans.ts` | Zod: entry create/patch, feedback create/patch | 3 |
| `packages/api/src/pg-errors.ts` | `isFkViolation` / `isUniqueViolation` — lifted out of `routes/recipes.ts` and `routes/pantry.ts` on third use | 4 |
| `packages/api/src/routes/meal-plans.ts` | Existing week GET + POST/PATCH/DELETE; mounts sub-routers | 4 |
| `packages/api/src/__tests__/meal-plans.test.ts` | Extend existing file with write-path cases | 4 |
| `packages/api/src/routes/meal-plan-cook.ts` | `POST /:id/cook` | 5 |
| `packages/api/src/__tests__/meal-plan-cook.test.ts` | Cook route guards + wiring | 5 |
| `packages/api/src/routes/meal-plan-feedback.ts` | `GET`/`POST`/`PATCH /:id/feedback` | 6 |
| `packages/api/src/__tests__/meal-plan-feedback.test.ts` | Feedback route guards | 6 |
| `packages/api/src/__tests__/routes.test.ts` | Real-DB cook chain smoke | 7 |

`app.ts` is **not** modified — sub-routers mount inside `mealPlansRoutes` via `app.route('/', …)`.

---

### Task 1: Unit conversion module `[Mode: Direct]`

**Files:**
- Create: `packages/api/src/units.ts`
- Test: `packages/api/src/__tests__/units.test.ts`

**Contracts:**

```ts
export type Dimension = 'mass' | 'volume' | 'count';

// Resolve a free-text unit to its dimension and the multiplier that converts
// one of that unit into the dimension's base (mass→g, volume→ml, count→pieces).
// Unknown unit → null. Case-insensitive, whitespace-trimmed.
export function resolveUnit(unit: string): { dimension: Dimension; factor: number } | null;

// quantity in `unit` → base value. null when the unit is unknown.
export function toBase(quantity: number, unit: string): { dimension: Dimension; value: number } | null;

// base value → quantity expressed in `unit`. null when the unit is unknown.
export function fromBase(value: number, unit: string): number | null;
```

Conversion table (the whole of it — no other units are recognized):

| Dimension | Base | Units → factor |
| --------- | ---- | -------------- |
| mass | `g` | `mg` 0.001, `g` 1, `kg` 1000 |
| volume | `ml` | `ml` 1, `cl` 10, `dl` 100, `l` 1000, `tsp` 5, `tl` 5, `tbsp` 15, `rkl` 15 |
| count | `pieces` | `piece` 1, `pieces` 1, `pcs` 1, `kpl` 1 |

**Test Cases:**

```ts
test('resolves mass units to grams', () => {
  expect(toBase(1, 'kg')).toEqual({ dimension: 'mass', value: 1000 });
  expect(toBase(500, 'g')).toEqual({ dimension: 'mass', value: 500 });
  expect(toBase(2500, 'mg')).toEqual({ dimension: 'mass', value: 2.5 });
});

test('resolves volume units to millilitres, including Finnish spoon units', () => {
  expect(toBase(1, 'l')).toEqual({ dimension: 'volume', value: 1000 });
  expect(toBase(2, 'dl')).toEqual({ dimension: 'volume', value: 200 });
  expect(toBase(1, 'rkl')).toEqual({ dimension: 'volume', value: 15 });
  expect(toBase(1, 'tl')).toEqual({ dimension: 'volume', value: 5 });
});

test('treats piece-like units as one count dimension', () => {
  for (const u of ['piece', 'pieces', 'pcs', 'kpl']) {
    expect(toBase(3, u)).toEqual({ dimension: 'count', value: 3 });
  }
});

test('is case-insensitive and trims whitespace', () => {
  expect(toBase(1, ' KG ')).toEqual({ dimension: 'mass', value: 1000 });
  expect(toBase(1, 'Dl')).toEqual({ dimension: 'volume', value: 100 });
});

test('returns null for unknown units rather than throwing', () => {
  for (const u of ['', 'handful', 'cup', 'oz', 'pinch']) {
    expect(toBase(1, u)).toBeNull();
    expect(fromBase(1, u)).toBeNull();
  }
});

test('fromBase inverts toBase', () => {
  expect(fromBase(1000, 'kg')).toBe(1);
  expect(fromBase(250, 'dl')).toBe(2.5);
  expect(fromBase(15, 'rkl')).toBe(1);
});

test('mass and volume never share a dimension', () => {
  expect(resolveUnit('g')!.dimension).not.toBe(resolveUnit('ml')!.dimension);
  expect(resolveUnit('kpl')!.dimension).not.toBe(resolveUnit('g')!.dimension);
});
```

**Constraints:**
- No `throw` on bad input — `null` is the failure channel; callers branch on it.
- Table-driven: one `Record<string, {dimension, factor}>` literal, not a switch.
- First-line file description comment per project convention.

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run units`
Expected: all pass.

**Commit after passing.**

---

### Task 2: Deduction planner `[Mode: Delegated]`

**Files:**
- Create: `packages/api/src/cook-deduct.ts`
- Test: `packages/api/src/__tests__/cook-deduct.test.ts`

**Contracts:**

```ts
import type { Dimension } from './units.js';

export interface RecipeLine {
  ingredientId: string;
  quantity: number;      // per the recipe's own base servings
  unit: string;
  optional: boolean;
}

export interface PantryRow {
  id: string;
  ingredientId: string;
  quantity: number;
  unit: string;
  expiresDate: string;   // YYYY-MM-DD
  opened: boolean;
  createdAt: string;     // ISO timestamp, tiebreak only
}

export interface PantryChange {
  id: string;
  unit: string;          // the row's own unit, unchanged
  before: number;
  after: number;         // in the row's own unit
  deleted: boolean;      // after === 0
}

export interface Deduction {
  ingredientId: string;
  dimension: Dimension;
  requested: number;     // base units, after scaling
  deducted: number;      // base units actually taken
  pantryItems: PantryChange[];
}

export interface Shortfall {
  ingredientId: string;
  dimension: Dimension | null;   // null when the recipe line's own unit is unknown
  requested: number;
  available: number;
  reason: 'not_in_pantry' | 'insufficient_stock' | 'unit_mismatch';
}

export function planDeduction(
  lines: RecipeLine[],
  pantryRows: PantryRow[],
  scale: number,
): { deductions: Deduction[]; shortfalls: Shortfall[] };
```

**Behavior (from the spec — implement exactly):**
- `needed = line.quantity * scale`, converted to base. Unresolvable line unit → `unit_mismatch` shortfall, `dimension: null`, no deduction.
- Only pantry rows of the **same dimension** are eligible. Rows in another dimension are ignored entirely.
- FEFO order: `expiresDate` ascending → `opened` first → `createdAt` ascending.
- Consume rows in order until satisfied; each touched row produces a `PantryChange` with `after` expressed in that row's own unit.
- Residual `< 1e-9` counts as satisfied; a row remainder `< 1e-9` sets `after: 0, deleted: true`.
- Quantities rounded to 6 decimal places before being reported.
- Leftover need → shortfall (`not_in_pantry` when zero eligible rows existed, `insufficient_stock` when rows existed but ran out, `unit_mismatch` when rows existed for the ingredient but none in a compatible dimension).
- **Optional lines deduct opportunistically and never produce a shortfall.**
- A line with a fully-satisfied need still emits a `Deduction`; a line that deducts nothing emits no `Deduction` (only a shortfall, unless optional).

**Test Cases:**

```ts
const ROW = (over: Partial<PantryRow> = {}): PantryRow => ({
  id: 'p1', ingredientId: 'i1', quantity: 1000, unit: 'g',
  expiresDate: '2026-08-01', opened: false, createdAt: '2026-07-01T00:00:00Z', ...over,
});
const LINE = (over: Partial<RecipeLine> = {}): RecipeLine => ({
  ingredientId: 'i1', quantity: 500, unit: 'g', optional: false, ...over,
});

test('deducts an exact match from a single row', () => {
  const { deductions, shortfalls } = planDeduction([LINE()], [ROW()], 1);
  expect(shortfalls).toEqual([]);
  expect(deductions[0].deducted).toBe(500);
  expect(deductions[0].pantryItems).toEqual([
    { id: 'p1', unit: 'g', before: 1000, after: 500, deleted: false },
  ]);
});

test('converts across units within a dimension', () => {
  // recipe wants 500 g; pantry holds 1 kg → 0.5 kg left, still stored in kg
  const { deductions } = planDeduction([LINE()], [ROW({ quantity: 1, unit: 'kg' })], 1);
  expect(deductions[0].pantryItems[0]).toEqual({
    id: 'p1', unit: 'kg', before: 1, after: 0.5, deleted: false,
  });
});

test('consumes soonest-expiring rows first (FEFO)', () => {
  const rows = [
    ROW({ id: 'later', quantity: 400, expiresDate: '2026-09-01' }),
    ROW({ id: 'sooner', quantity: 400, expiresDate: '2026-07-25' }),
  ];
  const { deductions } = planDeduction([LINE()], rows, 1);
  const touched = deductions[0].pantryItems;
  expect(touched[0].id).toBe('sooner');
  expect(touched[0]).toMatchObject({ after: 0, deleted: true });
  expect(touched[1]).toMatchObject({ id: 'later', after: 300, deleted: false });
});

test('prefers opened rows when expiry ties', () => {
  const rows = [
    ROW({ id: 'sealed', quantity: 600, opened: false }),
    ROW({ id: 'open', quantity: 600, opened: true }),
  ];
  const { deductions } = planDeduction([LINE()], rows, 1);
  expect(deductions[0].pantryItems[0].id).toBe('open');
});

test('scales the requirement by servings', () => {
  const half = planDeduction([LINE()], [ROW()], 0.5);
  expect(half.deductions[0].deducted).toBe(250);
  const double = planDeduction([LINE()], [ROW()], 2);
  expect(double.deductions[0].deducted).toBe(1000);
  expect(double.deductions[0].pantryItems[0]).toMatchObject({ after: 0, deleted: true });
});

test('reports insufficient_stock and still deducts what exists', () => {
  const { deductions, shortfalls } = planDeduction([LINE()], [ROW({ quantity: 200 })], 1);
  expect(deductions[0].deducted).toBe(200);
  expect(shortfalls).toEqual([
    { ingredientId: 'i1', dimension: 'mass', requested: 500, available: 200,
      reason: 'insufficient_stock' },
  ]);
});

test('reports not_in_pantry when the ingredient has no rows', () => {
  const { deductions, shortfalls } = planDeduction([LINE()], [], 1);
  expect(deductions).toEqual([]);
  expect(shortfalls[0]).toMatchObject({ reason: 'not_in_pantry', available: 0 });
});

test('never deducts across dimensions', () => {
  // recipe wants 500 g; the only stock is 3 pieces → no deduction at all
  const { deductions, shortfalls } = planDeduction([LINE()], [ROW({ quantity: 3, unit: 'pcs' })], 1);
  expect(deductions).toEqual([]);
  expect(shortfalls[0]).toMatchObject({ reason: 'unit_mismatch' });
});

test('reports unit_mismatch with a null dimension for an unknown recipe unit', () => {
  const { shortfalls } = planDeduction([LINE({ unit: 'handful' })], [ROW()], 1);
  expect(shortfalls[0]).toMatchObject({ reason: 'unit_mismatch', dimension: null });
});

test('optional lines deduct what is there and never report a shortfall', () => {
  const line = LINE({ optional: true });
  const short = planDeduction([line], [ROW({ quantity: 100 })], 1);
  expect(short.deductions[0].deducted).toBe(100);
  expect(short.shortfalls).toEqual([]);
  const absent = planDeduction([line], [], 1);
  expect(absent.shortfalls).toEqual([]);
  expect(absent.deductions).toEqual([]);   // nothing taken → no Deduction either
});

test('treats float residue below epsilon as fully consumed', () => {
  // 0.1 + 0.2 style residue must not leave a 1e-17 row behind
  const { deductions } = planDeduction([LINE({ quantity: 0.3 })], [ROW({ quantity: 0.3 })], 1);
  expect(deductions[0].pantryItems[0]).toMatchObject({ after: 0, deleted: true });
});

test('handles multiple lines independently', () => {
  const lines = [LINE(), LINE({ ingredientId: 'i2', quantity: 2, unit: 'dl' })];
  const rows = [ROW(), ROW({ id: 'p2', ingredientId: 'i2', quantity: 1, unit: 'l' })];
  const { deductions, shortfalls } = planDeduction(lines, rows, 1);
  expect(shortfalls).toEqual([]);
  expect(deductions).toHaveLength(2);
  expect(deductions[1].pantryItems[0]).toMatchObject({ unit: 'l', after: 0.8 });
});
```

**Constraints:**
- Pure: no imports beyond `./units.js` and types. No `Date.now()`, no DB, no Hono.
- Input arrays are never mutated (sort a copy).
- File stays well under 300 lines; extract a `sortFefo` helper rather than inlining a long comparator.

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run cook-deduct`
Expected: all pass.

**Commit after passing.**

---

### Task 3: Zod schemas `[Mode: Direct]`

**Files:**
- Create: `packages/api/src/schemas/meal-plans.ts`

**Contracts:**

```ts
export const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const STATUSES = ['planned', 'cooked', 'skipped', 'substituted'] as const;

export const mealPlanCreateSchema;   // refined: recipeId or freeformNote required
export const mealPlanPatchSchema;    // .strict(), all optional, nullable clears
export const feedbackCreateSchema;   // refined: changesNote required iff !usedAsIs
export const feedbackPatchSchema;    // .strict(), all optional

export type MealPlanCreate = z.infer<typeof mealPlanCreateSchema>;
export type MealPlanPatch = z.infer<typeof mealPlanPatchSchema>;
export type FeedbackCreate = z.infer<typeof feedbackCreateSchema>;
export type FeedbackPatch = z.infer<typeof feedbackPatchSchema>;
```

Field rules per the spec's contract tables. Reuse `uuidField` / `isoDateField` idioms from `schemas/pantry.ts` (`z.string().refine(isUuid)`), `z.coerce.number().positive()` for `servings`.

`feedbackPatchSchema` must **not** carry the `usedAsIs`/`changesNote` refinement — that rule is enforced against the merged row in the route (Task 6), since the patch alone lacks the stored values.

**Test Cases:** covered via the route tests in Tasks 4 and 6 — no standalone schema test file. (`schemas/pantry.ts` and `schemas/recipes.ts` set this precedent.)

**Constraints:**
- Export the enum tuples so routes and tests share one source of truth.
- `.strict()` on both patch schemas so unknown keys 400 instead of being silently dropped.

**Verification:** `build-lock tsc --noEmit` from `packages/api` — no type errors. (Behavior verified in Tasks 4/6.)

**Commit with Task 4.**

---

### Task 4: Meal plan entry writes `[Mode: Direct]`

**Files:**
- Modify: `packages/api/src/routes/meal-plans.ts`
- Modify: `packages/api/src/__tests__/meal-plans.test.ts`

**Contracts:** `POST /`, `PATCH /:id`, `DELETE /:id` per the spec. `mealPlansRoutes(db: Db): Hono` signature unchanged; it additionally mounts `app.route('/', mealPlanCookRoutes(db))` and `app.route('/', mealPlanFeedbackRoutes(db))` once Tasks 5–6 land.

**Test Cases:**

```ts
test('POST creates an entry', async () => { /* 201, body echoes date/slot/status */ });

test('POST rejects an entry with neither recipeId nor freeformNote', async () => {
  // 400 { error: 'Validation failed' } — no insert attempted
});

test('POST rejects an unknown slot', async () => { /* 400 */ });

test('PATCH rejects an empty body', async () => { /* 400, formErrors: ['Empty patch body'] */ });

test('PATCH rejects unknown keys', async () => { /* 400 via .strict() */ });

test('PATCH rejects clearing the last content field', async () => {
  // stored: { recipeId: null, freeformNote: 'takeaway' }; patch { freeformNote: null } → 400
  // merged result would have neither → the POST content rule re-applied
});

test('PATCH cannot mark an entry cooked', async () => {
  // stored status 'planned', patch { status: 'cooked' } → 409
  expect(body).toEqual({ error: 'Use POST /meal-plans/:id/cook to mark an entry cooked' });
});

test('PATCH cannot change the status of a cooked entry', async () => {
  // stored status 'cooked', patch { status: 'planned' } → 409
  expect(body).toEqual({ error: 'Cooked meal plan entry status is immutable' });
});

test('PATCH accepts a no-op cooked status and other fields on a cooked entry', async () => {
  // stored 'cooked', patch { status: 'cooked', notes: 'salty' } → 200
});

test('PATCH allows planned -> skipped', async () => { /* 200 */ });

test('DELETE returns 409 when cook feedback exists', async () => {
  expect(body).toEqual({ error: 'Meal plan entry has cook feedback' });
});

test('DELETE returns 204 and 404 for a missing entry', async () => { /* both */ });

test('write routes reject a malformed :id before touching the db', async () => {
  // PATCH and DELETE with 'not-a-uuid' → 400 { error: 'Invalid id format' }, db untouched
});
```

Existing `GET /week/:date` tests must keep passing unchanged.

**Constraints:**
- Follow `routes/pantry.ts` exactly: `readJsonBody` → `safeParse` → `badRequest(c, 'Validation failed', z.flattenError(...))`.
- Catch Postgres `23503` on POST/PATCH → `badRequest(c, 'Invalid reference')`. This is the **third** occurrence of the check (`routes/recipes.ts` has it as the named `isFkViolation`, `routes/pantry.ts` inlines the same test) — lift it to a shared module and have all three use it, rather than copying it again.
- `servings` written as `String(n)`; responses keep Drizzle's string numeric shape.
- Mock DB fakes need `insert`/`update`/`delete` chains — extend the pattern already in `recipes.test.ts`, don't build a Drizzle emulator.

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run meal-plans` and `build-lock tsc --noEmit`
Expected: all pass, no type errors.

**Commit after passing** (with Task 3).

---

### Task 5: Cook endpoint `[Mode: Delegated]`

**Files:**
- Create: `packages/api/src/routes/meal-plan-cook.ts`
- Create: `packages/api/src/__tests__/meal-plan-cook.test.ts`
- Modify: `packages/api/src/routes/meal-plans.ts` (mount the sub-router)

**Contracts:**

```ts
export function mealPlanCookRoutes(db: Db): Hono;   // registers POST /:id/cook
```

Transaction sequence exactly as the spec's #241 section lists (steps 1–6): lock the entry, resolve `substituteRecipeId ?? recipeId`, load recipe + lines + candidate pantry rows `FOR UPDATE`, `scale = Number(entry.servings) / recipe.servings`, `planDeduction`, apply changes, delete zeroed rows, increment `recipes.timesCooked`, set `status = 'cooked'`.

Response `200 { entry, deductions, shortfalls }`. `shortfalls` is the planner's output verbatim. `deductions` is the planner's output with **`pantryItems[].before` and `.after` stringified** — those two mirror `pantry_items.quantity`, which every other endpoint returns as a Drizzle string numeric, and the design's example response shows them quoted. The planner itself stays in `number` (it does arithmetic); the route converts at the response boundary, same as it does when writing `String(n)` back to the column.

**Test Cases:**

```ts
test('returns 400 for a malformed id without touching the db', async () => {});

test('returns 404 for a missing entry', async () => {});

test('returns 409 when the entry is already cooked', async () => {
  expect(body).toEqual({ error: 'Meal plan entry already cooked' });
});

test('cooks a freeform entry with no recipe: status flips, nothing deducted', async () => {
  // recipeId and substituteRecipeId both null → 200
  expect(body.deductions).toEqual([]);
  expect(body.shortfalls).toEqual([]);
  expect(body.entry.status).toBe('cooked');
});

test('prefers substituteRecipeId over recipeId when resolving the recipe', async () => {
  // assert the recipe actually loaded is the substitute
});

test('scales the deduction by entry servings over recipe servings', async () => {
  // recipe.servings 2, entry.servings 4 → planner called with scale 2
});

test('applies planner output: updates touched rows, deletes zeroed rows, bumps timesCooked', async () => {
  // fake tx records insert/update/delete calls; assert each expected call happened
});

test('a shortfall does not prevent the cook', async () => {
  // planner returns a shortfall → still 200, status cooked, shortfall echoed
});

test('response quantities are stringified like every other numeric column', async () => {
  // planner yields { before: 1, after: 0.5 } → response has "1" / "0.5"
  expect(body.deductions[0].pantryItems[0]).toEqual({
    id: expect.any(String), unit: 'kg', before: '1', after: '0.5', deleted: false,
  });
});
```

**Constraints:**
- Every read and write in **one** `db.transaction`; a thrown error must roll back the whole cook.
- Entry and pantry reads use `.for('update')`. This is the first use of `.for()` in the codebase — verify it type-checks against `drizzle-orm@0.45.2` and adjust the query shape (core builder, not `db.query.*`) if the relational API does not expose it.
- All deduction logic stays in `cook-deduct.ts` — this route contains no arithmetic beyond computing `scale`.
- File under 300 lines. If applying the plan gets long, extract an `applyDeductions(tx, deductions)` helper into the same file.

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run meal-plan-cook` and `build-lock tsc --noEmit`
Expected: all pass, no type errors.

**Commit after passing.**

---

### Task 6: Feedback endpoints `[Mode: Direct]`

**Files:**
- Create: `packages/api/src/routes/meal-plan-feedback.ts`
- Create: `packages/api/src/__tests__/meal-plan-feedback.test.ts`
- Modify: `packages/api/src/routes/meal-plans.ts` (mount the sub-router)

**Contracts:**

```ts
export function mealPlanFeedbackRoutes(db: Db): Hono;  // GET/POST/PATCH /:id/feedback
```

**Test Cases:**

```ts
test('POST creates feedback for a cooked entry', async () => { /* 201 */ });

test('POST returns 409 when the entry is not cooked', async () => {
  expect(body).toEqual({ error: 'Meal plan entry is not cooked' });
});

test('POST returns 409 when feedback already exists', async () => {
  expect(body).toEqual({ error: 'Feedback already exists for this meal plan entry' });
});

test('POST maps a unique-violation race (23505) to the same 409', async () => {});

test('POST requires changesNote when usedAsIs is false', async () => { /* 400 */ });

test('POST rejects changesNote when usedAsIs is true', async () => { /* 400 */ });

test('POST rejects values outside the enum vocabularies', async () => {
  // rating 'meh', effortCheck 'fine', makeAgain 'sure' → 400
});

test('GET returns the feedback, 404 when absent', async () => {});

test('PATCH enforces the usedAsIs rule against the merged row', async () => {
  // stored { usedAsIs: true, changesNote: null }; patch { usedAsIs: false } → 400
  // same stored row; patch { usedAsIs: false, changesNote: 'less salt' } → 200
});

test('PATCH rejects an empty body and unknown keys', async () => { /* 400 each */ });

test('all three routes reject a malformed :id before touching the db', async () => {
  // GET/POST/PATCH with 'not-a-uuid' → 400 { error: 'Invalid id format' }
});
```

**Constraints:**
- The merged-row rule is route logic, not schema logic — load the stored row, apply the patch, validate the result.
- Catch Postgres `23505` on insert → the same 409 body as the pre-check (race backstop, mirroring how `routes/recipes.ts` treats `23503` on delete).

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run meal-plan-feedback` and `build-lock tsc --noEmit`
Expected: all pass, no type errors.

**Commit after passing.**

---

### Task 7: Real-DB integration smoke `[Mode: Delegated]`

**Files:**
- Modify: `packages/api/src/__tests__/routes.test.ts`

**Contracts:** One `describe.skipIf(!hasDb)` block exercising the full chain against `dietapp_test`.

**Test Cases:**

```ts
describe.skipIf(!hasDb)('cook flow', () => {
  test('cooking an entry deducts pantry stock and increments timesCooked', async () => {
    // 1. GET /api/ingredients → take a real ingredient id (never hardcode a UUID)
    // 2. POST /api/recipes  — servings 2, one line: 500 g of that ingredient
    // 3. POST /api/pantry   — 1 kg of the same ingredient (explicit expiresDate,
    //                         so a missing shelf-life key cannot 400 the setup)
    // 4. POST /api/meal-plans — recipeId, servings 2, slot dinner
    // 5. POST /api/meal-plans/:id/cook → 200
    //      expect(body.entry.status).toBe('cooked')
    //      expect(body.shortfalls).toEqual([])
    // 6. GET /api/pantry/:id  → quantity dropped 1 → 0.5 (kg)   <-- the assertion that matters
    // 7. GET /api/recipes/:id → timesCooked === 1
    // 8. POST /api/meal-plans/:id/cook again → 409
    // 9. POST /api/meal-plans/:id/feedback → 201; GET → 200
    // cleanup in finally: feedback has no DELETE route, so remove the entry's
    // feedback row directly via db before DELETE /api/meal-plans/:id (which 409s
    // while feedback exists), then the recipe, then the pantry item
  });
});
```

**Constraints:**
- Clean up **every** created row in `finally` — the suite must be re-runnable and leave no residue.
- Deletion order matters: feedback → meal plan entry → recipe (409s while the entry references it) → pantry item.
- The step-6 quantity assertion is the point of this task. A test that only asserts the cook returned 200 proves nothing about inventory.
- If `TEST_DATABASE_URL` is unset the block skips; provision with `pnpm --filter @diet-app/db setup:test-db`.

**Verification:**
Run: `pnpm --filter @diet-app/api exec vitest run routes`
Expected: the cook-flow block runs (not skipped) and passes against `dietapp_test`.

**Commit after passing.**

---

### Task 8: Docs, roadmap, deploy `[Mode: Direct]`

**Files:**
- Modify: `CLAUDE.md` — add the cook-flow conventions to Key Patterns: `cooked` is terminal and reachable only via `POST /meal-plans/:id/cook`; unit conversion lives in `units.ts` and never crosses dimensions; deduction is FEFO and pure in `cook-deduct.ts`. Add the two new design/plan docs to the Plans section.

**Constraints:**
- Keep CLAUDE.md a map: one line per convention, no walkthrough.
- Doc changes amend into the last code commit — no standalone docs commit.

**Verification:**
- `pnpm --filter @diet-app/api exec vitest run` (full API suite) and `build-lock tsc --noEmit` both clean.
- `deploy` succeeds.
- Live check against the deployed API: create an entry, cook it, confirm the pantry quantity actually moved (`https://mase.fi/diet/api/`, Bearer token from `.env`).
- `helm roadmap status 379 done`, `helm roadmap status 241 done`, `helm roadmap status 377 done` — **only after** the live check. (#377's misleading item text — it named `POST /recipes/:id/feedback` and an `actual_servings` column that does not exist — was already corrected via `helm roadmap update 377 --details` during planning; no further roadmap edit is needed.)
- `mase-fi-update feature diet-app "Meal plan cooking now auto-deducts ingredients from the pantry"`.

**Commit and deploy.**

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: orchestrator implements directly
- Mode B tasks: Dispatched to subagents

Task order is sequential — 2 depends on 1, 5 depends on 2 and 4, 6 depends on 3, 7 depends on everything. Tasks 5 and 6 touch `routes/meal-plans.ts` (the mount lines) and must not run in parallel.
