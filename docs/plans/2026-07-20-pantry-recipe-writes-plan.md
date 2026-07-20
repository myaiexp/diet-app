# Pantry + Recipe Write Endpoints Implementation Plan

**Goal:** Ship POST/PATCH/DELETE for pantry items (#236) and recipes (#237) per the approved design.

**Architecture:** Zod-validated write handlers on existing Hono route modules; shared response helpers; pantry expiry resolved only on create; recipe multi-step writes/deletes run in transactions; unit mocks cover validation/status codes, integration smokes use seeded ingredients.

**Tech Stack:** Hono, Drizzle ORM, Zod 4 (`z.flattenError`), Vitest, PostgreSQL

**Spec:** `docs/plans/2026-07-20-pantry-recipe-writes-design.md`

---

### Task 1: Shared write helpers + response shapes

**Files:**
- Modify: `packages/api/src/responses.ts`
- Create: `packages/api/src/json-body.ts` (or equivalent small helper)
- Test: `packages/api/src/__tests__/responses.test.ts` (optional if pure enough; otherwise exercise via route tests)

**Contracts:**

```ts
// responses.ts
export function notFound(c: Context): Response; // existing
export function badRequest(c: Context, error: string, details?: unknown): Response; // 400
export function conflict(c: Context, error: string): Response; // 409

// json-body.ts
export async function readJsonBody(c: Context): Promise<
  | { ok: true; data: unknown }
  | { ok: false; response: Response } // 400 Invalid JSON body
>;
```

Zod parse failures at call sites:

```ts
// Pattern (not full impl)
const parsed = schema.safeParse(body);
if (!parsed.success) {
  return badRequest(c, 'Validation failed', z.flattenError(parsed.error));
}
```

**Test Cases:**

```ts
test('badRequest returns 400 with error and optional details');
test('conflict returns 409 with error only');
test('readJsonBody returns ok:false for empty/non-JSON body');
```

**Constraints:**
- Match design error strings exactly where specified.
- No auth changes.

**Verification:**
Run: `build-lock pnpm --filter @diet-app/api test responses` (or full unit file once written)  
Expected: pass

**Commit after passing.**

`[Mode: Direct]`

---

### Task 2: Pantry Zod schemas + expiry helper

**Files:**
- Create: `packages/api/src/schemas/pantry.ts`
- Create: `packages/api/src/pantry-expiry.ts`
- Test: `packages/api/src/__tests__/pantry-expiry.test.ts`
- Test: schema behavior covered by route tests or thin schema unit tests

**Contracts:**

```ts
// schemas/pantry.ts
export const pantryCreateSchema: ZodType; // ingredientId uuid, quantity positive, unit non-empty,
// location enum fridge|freezer|pantry|counter, addedDate optional ISO date, expiresDate optional ISO date, opened optional bool

export const pantryPatchSchema: ZodType; // partial of mutable fields; reject empty object after parse
// (empty object → handler returns 400)

// pantry-expiry.ts
export type ShelfLife = Record<string, number | null | undefined>;

/** Returns YYYY-MM-DD or null if no shelf-life default for location. */
export function resolveExpiresDate(
  shelfLife: ShelfLife | null | undefined,
  location: string,
  addedDate: string, // YYYY-MM-DD
): string | null;
```

**Test Cases:**

```ts
test('resolveExpiresDate adds fridge_days to addedDate');
test('resolveExpiresDate returns null when key missing or null (e.g. counter)');
test('resolveExpiresDate uses pantry_days for location pantry');
```

**Constraints:**
- Key rule: `${location}_days` (e.g. `fridge` → `fridge_days`).
- Use calendar-date arithmetic stable in UTC (same spirit as `computeStatus`).
- No DB access in helper.

**Verification:**
Run: `build-lock pnpm --filter @diet-app/api test pantry-expiry`  
Expected: pass

**Commit after passing.**

`[Mode: Direct]`

---

### Task 3: Pantry POST / PATCH / DELETE

**Files:**
- Modify: `packages/api/src/routes/pantry.ts`
- Modify: `packages/api/src/__tests__/pantry.test.ts`
- Modify: `packages/api/src/__tests__/routes.test.ts` (write smoke)

**Contracts:**

```
POST   /           → 201 row+status | 400 validation/json/expiry/missing ingredient
PATCH  /:id        → 200 row+status | 400 | 404
DELETE /:id        → 204 | 400 invalid id | 404
```

- POST defaults: `addedDate` = today UTC `YYYY-MM-DD` if omitted; `opened` = false if omitted; resolve `expiresDate` only when omitted (via ingredient shelf life).
- POST: load ingredient by id; if missing → `400 Invalid reference`; if no `expiresDate` and `resolveExpiresDate` null → `400` requiring expiresDate; insert; return with `computeStatus`.
- PATCH: client-owned expiry only (never recompute); no `ingredientId` change; bump `updatedAt`.
- DELETE: hard delete; 204 empty body.
- Quantity: accept number; response quantity string-like (Drizzle numeric).
- Unit write mocks need thin `insert`/`update`/`delete` fakes (beyond `makeSelectMock`).

**Test Cases (unit, mock DB):**

```ts
test('POST / creates item and returns status field');
test('POST / rejects invalid location with 400 Validation failed');
test('POST / without expiresDate when shelf life missing returns 400');
test('POST / invalid JSON returns 400 Invalid JSON body');
test('PATCH /:id returns 404 when missing');
test('PATCH /:id rejects empty body');
test('PATCH /:id does not recompute expiresDate when only location changes'); // assert update payload
test('DELETE /:id returns 204 when deleted');
test('DELETE /:id returns 404 when missing');
test('PATCH/DELETE reject non-uuid with 400 before DB');
```

**Integration smoke:**

```ts
test('pantry write cycle: resolve ingredient → POST → GET → PATCH → DELETE');
```

**Constraints:**
- Keep GET handlers unchanged in behavior.
- File stays under 300 lines; extract helpers if needed.

**Verification:**
Run: `build-lock pnpm --filter @diet-app/api test pantry`  
With `TEST_DATABASE_URL` set: `build-lock pnpm --filter @diet-app/api test routes`  
Expected: pass

**Commit after passing.**

`[Mode: Direct]`

---

### Task 4: Recipe Zod schemas

**Files:**
- Create: `packages/api/src/schemas/recipes.ts`

**Contracts:**

```ts
export const recipeIngredientLineSchema; // ingredientId uuid, quantity positive, unit non-empty, optional bool default false, notes nullable optional
export const recipeCreateSchema; // full design field table: title required; sourceType default manual
// enum manual|imported|ai|forked; sourceUrl; parentRecipeId; steps string[] default [];
// prepTime, totalTime, servings default 1, effortScore 1-5, tags, cuisineType;
// ingredients min 1; no timesCooked/userRating
export const recipePatchSchema; // partial of those header fields; ingredients optional array min 1 if present;
// nullable clear: sourceUrl, parentRecipeId, cuisineType via null
```

**Test Cases:** Covered primarily by route tests; optional thin parse tests if useful.

**Constraints:**
- Supersede project-init source_type vocabulary as design states.
- Empty ingredients array invalid on create and on replace.

**Verification:**
Covered by Task 5 tests.

**Commit with Task 5.**

`[Mode: Direct]`

---

### Task 5: Recipe POST / PATCH / DELETE

**Files:**
- Modify: `packages/api/src/routes/recipes.ts`
- Modify: `packages/api/src/__tests__/recipes.test.ts`
- Modify: `packages/api/src/__tests__/routes.test.ts`

**Contracts:**

```
POST   /           → 201 full recipe (GET :id shape) | 400
PATCH  /:id        → 200 full recipe | 400 | 404
DELETE /:id        → 204 | 400 | 404 | 409
```

- POST: transaction insert recipe + ingredient lines; re-fetch with relations. Map remaining `23503` → `400 Invalid reference`.
- PATCH: header partial; if `ingredients` key present → full replace in transaction (min 1); never write timesCooked/userRating; null clears nullable columns. Map `23503` → `400 Invalid reference`.
- DELETE:
  1. If meal_plan_entries reference as recipeId or substituteRecipeId → `409 Recipe is referenced by meal plan entries`
  2. If any recipe has parentRecipeId = id → `409 Recipe has forked child recipes`
  3. Else transaction: delete recipe_ingredients, delete recipe
  4. Catch concurrent `23503` → 409 family (not 400)

**Test Cases (unit):**

```ts
test('POST / creates recipe and returns recipeIngredients');
test('POST / rejects empty ingredients array');
test('POST / rejects missing title');
test('PATCH /:id 404 when missing');
test('PATCH /:id rejects empty body with 400');
test('PATCH /:id header-only leaves ingredients when ingredients key omitted');
test('PATCH /:id with ingredients replaces set');
test('DELETE /:id 204 when free');
test('DELETE /:id 409 when meal plan references');
test('DELETE /:id 409 when child fork exists');
test('DELETE /:id 404 when missing');
```

**Integration smoke:**

```ts
// use try/finally so DELETE cleanup runs even if mid-cycle asserts fail
test('recipe write cycle: ingredient from seed → POST → GET → PATCH → DELETE');
```

**Constraints:**
- Use `db.transaction` for multi-step writes.
- Map FK failures per design.
- File size: split if approaching 300 lines.

**Verification:**
Run: `build-lock pnpm --filter @diet-app/api test recipes`  
With DB: `build-lock pnpm --filter @diet-app/api test routes`  
Run: `build-lock pnpm --filter @diet-app/api exec tsc --noEmit` (or project typecheck via build-lock)  
Expected: all pass

**Commit after passing.**

`[Mode: Direct]`

---

### Task 6: Docs pointer + roadmap close-out

**Files:**
- Modify: `CLAUDE.md` only if a one-line pointer to the new design/plan is warranted under Plans (keep map short)
- Roadmap: `helm roadmap status 236 done`, `helm roadmap status 237 done` after green tests + deploy

**Contracts:** N/A

**Constraints:**
- Doc-only updates amend into the last code commit when possible.
- Deploy after final commit.

**Verification:**
`helm roadmap show diet-app` shows #236/#237 done.

`[Mode: Direct]`

---

## File structure summary

| Path | Role |
| ---- | ---- |
| `packages/api/src/responses.ts` | `badRequest`, `conflict` |
| `packages/api/src/json-body.ts` | Safe JSON body parse |
| `packages/api/src/schemas/pantry.ts` | Pantry write Zod |
| `packages/api/src/schemas/recipes.ts` | Recipe write Zod |
| `packages/api/src/pantry-expiry.ts` | Create-path expiry resolution |
| `packages/api/src/routes/pantry.ts` | POST/PATCH/DELETE |
| `packages/api/src/routes/recipes.ts` | POST/PATCH/DELETE |
| Unit + integration tests as above | |

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: orchestrator implements directly
- Mode B tasks: Dispatched to subagents
