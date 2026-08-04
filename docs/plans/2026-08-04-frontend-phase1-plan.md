# Ruoka Frontend — Phase 1 Implementation Plan

**Goal:** Ship a deployed, usable web frontend at `https://mase.fi/diet/` covering every
screen the existing API can actually serve — pantry, recipes, import, meal plan, cook flow,
profile, and a Today landing view.

**Architecture:** A new `packages/web` workspace: Vite + vanilla TypeScript, no framework.
One thin API client wraps `fetch` and is the single place credentials and error mapping
live. Screens are independent modules rendering into an app shell that swaps a sidebar
(desktop) for a bottom tab bar (phone). Served as static files by nginx from the same
origin as the API (`/diet/` and `/diet/api/`), so CORS is not involved.

**Tech Stack:** Vite, TypeScript, vanilla DOM, `https://mase.fi/base.css`, vitest.

**Design spec:** `docs/plans/2026-08-04-frontend-design.md` — authoritative for look,
layout, copy and interaction. Read its provenance header first: its API endpoint names are
wrong and are corrected there.

---

## Scope

**In scope (this plan)** — every screen backed by a live endpoint today:
Today, Pantry, Recipes, Recipe import, Meal plan, Cook confirm + feedback modals, Profile.

**Out of scope (a second plan, once their backends land)** — Shopping list (generation in
flight in another session), AI suggestions (#380), Nutrition (#385), Waste (#389). Their
nav entries render a shared "not built yet" placeholder so the shell is complete.

**Backend prerequisites:** Task 0 adds the cook-deduction preview endpoint (#3225), without
which the cook confirm modal cannot be built truthfully. Task 0b adds an inferred-quantity
flag to recipe import, without which the design's three-state reconciliation is not
computable.

---

## Open decision — how the browser authenticates

Every `/api/*` route except `/api/health` requires `Authorization: Bearer <API_TOKEN>`
(`packages/api/src/auth.ts`). A browser cannot hold a shared secret secretly, so this needs
a decision. **The plan is written so the choice is isolated to one module**
(`src/api/credentials.ts`); swapping options later touches nothing else.

**Recommended — nginx edge auth, token injected server-side.** Put `auth_basic` on
`location /diet/`, and have `location /diet/api/` set
`proxy_set_header Authorization "Bearer <token>"`. The API token never reaches the browser,
there is no login UI to build, and the browser remembers the credential. Carve
`/diet/api/health` out above the protected block so uptime checks stay public.
`credentials.ts` becomes a no-op that sends nothing.

**Fallback — token in `localStorage`.** A one-time paste screen stores the token; the client
attaches the header. Zero infra change, but the token sits in browser storage, readable by
any script that runs on the origin.

Task 1 implements the recommended option. If you prefer the fallback, say so and only
Task 1's `credentials.ts` and Task 11's nginx block change.

---

## File structure

```
packages/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/
    main.ts                  — entry: mount shell, start router
    router.ts                — history routing, route table → screen module
    api/
      client.ts              — fetch wrapper: base URL, credentials, error mapping
      credentials.ts         — the auth decision, isolated (see above)
      errors.ts              — ApiError type + status → user message
      pantry.ts, recipes.ts, meal-plans.ts, profile.ts, recipe-import.ts
      types.ts               — response types mirroring the DB schema
    format/
      quantity.ts            — display formatting (Finnish comma, round-to-5 >100)
      date.ts                — Finnish weekday/date, days-remaining labels
      expiry.ts              — status → ramp color + label (render only, never derive)
    ui/
      shell.ts               — app shell, sidebar + bottom tab bar, active state
      modal.ts               — modal open/close, backdrop, focus trap
      toast.ts               — say(msg), 2600ms, clears prior timer
      placeholder.ts         — "not built yet" screen for out-of-scope nav entries
    screens/
      today.ts, pantry.ts, recipes.ts, import.ts, plan.ts, profile.ts
    modals/
      cook-confirm.ts, cook-feedback.ts
    css/app.css              — project layer on top of base.css
```

Every file stays under 300 lines. `recipes.ts` (list + detail) and `plan.ts` (week grid) are
the two at risk — split detail rendering into a sibling module if either crosses.

---

## Task 0: Cook-deduction preview endpoint (backend)

**Files:**
- Modify: `packages/api/src/routes/meal-plan-cook.ts`
- Test: `packages/api/src/__tests__/meal-plan-cook.test.ts`

**Contracts:**
- `GET /api/meal-plans/:id/cook-preview?servings=N`
- Runs the same load → `planDeduction` path as `POST /:id/cook`, **without** a transaction,
  without `FOR UPDATE`, and without writing.
- Returns `200 { deductions, shortfalls, servings }` — the exact shapes `POST /:id/cook`
  already returns.
- `servings` is optional; absent ⇒ the entry's stored `servings`.
- `400` on a non-UUID id or a non-positive/non-finite `servings`.
- `404` when the entry does not exist.
- `409` when the entry is already `cooked` — a preview of a locked entry is meaningless and
  matching cook's own 409 keeps the two consistent.

**Test Cases:**

```ts
it('returns the same deduction plan as cook, without writing', async () => {
  // seed: entry planned, pantry stocked
  const preview = await app.request(`/api/meal-plans/${id}/cook-preview`);
  expect(preview.status).toBe(200);
  const before = await countPantryRows();
  // no write happened
  expect(await countPantryRows()).toBe(before);
  const cooked = await app.request(`/api/meal-plans/${id}/cook`, { method: 'POST' });
  expect((await preview.json()).deductions).toEqual((await cooked.json()).deductions);
});

it('honours a servings override without persisting it', async () => {
  const r = await app.request(`/api/meal-plans/${id}/cook-preview?servings=8`);
  expect((await r.json()).servings).toBe(8);
  expect((await loadEntry(id)).servings).toBe('4');
});

it('reports shortfalls for ingredients absent from the pantry', async () => {
  const { shortfalls } = await (await app.request(`/api/meal-plans/${id}/cook-preview`)).json();
  expect(shortfalls).toContainEqual(expect.objectContaining({ reason: 'not_in_pantry' }));
});

it('409s on an already-cooked entry', async () => { /* ... */ });
it('400s on a malformed id and on servings=0', async () => { /* ... */ });
```

**Constraints:**
- Reuse the existing row-loading helper rather than duplicating it; extract it if it is
  currently inlined in the cook handler.
- Read-only: no `db.transaction`, no `FOR UPDATE`. A preview must never hold locks.
- Preview and commit can disagree if the pantry changes in between. That is acceptable
  (single user) and the commit response remains the source of truth — the client reconciles
  from the cook response, not the preview.

**Verification:**
`pnpm --filter @diet-app/api test meal-plan-cook` and `pnpm --filter @diet-app/api typecheck`

**Commit after passing.** Closes idea #3225.

`[Mode: Direct]`

---

## Task 0b: Inferred-quantity flag on recipe import (backend)

**Files:**
- Modify: `packages/api/src/ai/import-recipe.ts` (extraction schema + system prompt)
- Modify: `packages/api/src/routes/recipe-import.ts` (`buildDraft` passthrough)
- Test: `packages/api/src/__tests__/recipe-import.test.ts`

**Why:** The design's reconciliation has three states — `bound`, `assumed`, `unresolved` —
and `assumed` is the valuable one: a line the model matched but whose quantity it *invented*
("1 iso sipuli" → 150 g). Those are what quietly poison a recipe. But nothing in the current
response can express it: `LineMatch.match` is only `'exact' | 'alias' | 'none'`, and
`extractedIngredientSchema` requires a concrete positive `quantity` with no provenance. The
flag has to come from the only component that knows — the extraction model.

**Contracts:**
- `extractedIngredientSchema` gains `quantityInferred: z.boolean().optional()` (default
  `false` when absent, so an older/undecorated model response stays valid).
- The system prompt instructs the model to set it `true` when the source text gave no
  explicit amount and a typical one was assumed.
- `buildDraft` passes it through onto each draft ingredient line.
- Response shape is otherwise unchanged; `unmatchedCount` keeps its current meaning.

**Test Cases:**

```ts
it('passes an inferred-quantity flag through to the draft line', async () => {
  const draft = await importWithMockedAi([
    { name: 'sipuli', quantity: 150, unit: 'g', quantityInferred: true },
  ]);
  expect(draft.ingredients[0].quantityInferred).toBe(true);
});

it('defaults the flag to false when the model omits it', async () => {
  const draft = await importWithMockedAi([{ name: 'voita', quantity: 40, unit: 'g' }]);
  expect(draft.ingredients[0].quantityInferred).toBe(false);
});

it('still rejects a line with no quantity at all', async () => {
  // the flag marks an inferred value, it does not make quantity optional
});
```

**Constraints:**
- The flag marks *provenance*, not absence — `quantity` stays required and positive. A line
  the model genuinely cannot quantify must still fail extraction rather than arrive with a
  silent zero.
- Optional with a `false` default: a model that ignores the instruction must not 502 the
  whole import.
- No client-side heuristic substitutes for this. Guessing "assumed" from round numbers would
  flag every legitimately-round quantity in the catalog.

**Verification:**
`pnpm --filter @diet-app/api test recipe-import` and `pnpm --filter @diet-app/api typecheck`

**Commit after passing.**

`[Mode: Direct]`

---

## Task 1: Workspace scaffold, app shell, routing

**Files:**
- Create: `packages/web/{package.json,tsconfig.json,vite.config.ts,index.html}`
- Create: `packages/web/src/{main.ts,router.ts}`
- Create: `packages/web/src/ui/{shell.ts,placeholder.ts}`
- Create: `packages/web/src/api/{client.ts,credentials.ts,errors.ts}`
- Create: `packages/web/src/css/app.css`

(`pnpm-workspace.yaml` already globs `packages/*` — no edit needed.)

**Contracts:**
```ts
// router.ts
type Route = '/today'|'/pantry'|'/recipes'|'/import'|'/plan'|'/profile'
           |'/shopping'|'/suggest'|'/nutrition'|'/waste';
export function startRouter(mount: HTMLElement): void;
export function navigate(to: Route): void;   // also closes any open modal

// api/client.ts
export function apiGet<T>(path: string, params?: Record<string,string|number>): Promise<T>;
export function apiSend<T>(method: 'POST'|'PATCH'|'DELETE', path: string, body?: unknown): Promise<T>;
// Base URL '/diet/api'. Throws ApiError on non-2xx.

// api/errors.ts
export class ApiError extends Error {
  status: number;
  body: { error?: string; details?: unknown } | null;
}
export function userMessage(e: unknown): string;
```

**Test Cases:**
```ts
it('maps a 404 body to its error string', () => {
  expect(userMessage(new ApiError(404, { error: 'Not found' }))).toBe('Not found');
});
it('maps 503 to the AI-unavailable message', () => { /* recipe import needs this */ });
it('maps a network failure to a generic retryable message', () => { /* fetch rejects */ });
it('navigate() closes an open modal', () => { /* ... */ });
it('an unknown path falls back to /today', () => { /* ... */ });
```

**Constraints:**
- `index.html` links `https://mase.fi/base.css` absolutely — a relative path 404s behind the
  `/diet/` proxy prefix.
- Vite `base: '/diet/'` so built asset URLs resolve behind the prefix.
- Shell follows the base.css scroll contract: `.app-shell` flex column, exactly one visible
  `.scroll-region` per pane, none nested.
- Sidebar (desktop) / bottom tab bar (phone) per the design doc's Layout section. The
  prototype's top chrome bar is scaffolding — do not build it.
- Out-of-scope routes render `placeholder.ts`, not a broken screen.

**Verification:**
`pnpm --filter @diet-app/web build && pnpm --filter @diet-app/web test`

`[Mode: Direct]`

---

## Task 2: Format utilities

**Files:**
- Create: `packages/web/src/format/{quantity.ts,date.ts,expiry.ts}`
- Test: `packages/web/src/__tests__/format.test.ts`

**Contracts:**
```ts
// quantity.ts — DISPLAY ONLY. Never send a formatted value back to the API.
export function formatQuantity(value: number, unit: string): string;
// >100 → round to nearest 5; <=100 → one decimal; comma decimal separator; space thousands.

// date.ts
export function finnishWeekday(d: string): string;      // 'ma'|'ti'|…|'su'
export function finnishDate(d: string): string;         // '4.8.'
export function daysRemainingLabel(days: number): string;
// -1 → '1d ago' · 0 → 'today' · 1 → '1 day' · <60 → 'N days' · else → 'N mo' (÷30 rounded)

// expiry.ts — RENDER ONLY. status comes from the API.
export type PantryStatus = 'fresh'|'use_soon'|'use_today'|'expired';
export function rampColor(s: PantryStatus): { text: string; badge: string; row: string|null };
```

**Test Cases:**
```ts
it('formats above 100 to the nearest 5', () => {
  expect(formatQuantity(402.5, 'g')).toBe('400 g');
  expect(formatQuantity(1480, 'g')).toBe('1 480 g');   // space thousands separator
});
it('formats at or below 100 to one decimal with a comma', () => {
  expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
  expect(formatQuantity(20, 'g')).toBe('20 g');        // no trailing ,0
});
it('labels days remaining', () => {
  expect(daysRemainingLabel(-1)).toBe('1d ago');
  expect(daysRemainingLabel(0)).toBe('today');
  expect(daysRemainingLabel(1)).toBe('1 day');
  expect(daysRemainingLabel(90)).toBe('3 mo');
});
it('maps every status to a ramp color', () => {
  expect(rampColor('use_soon').text).toBe('#e8a308');  // amber literal, not var(--accent)
});
```

**Constraints:**
- `expiry.ts` **must not** compute status from a date. The API returns `status` on every
  pantry row; a second implementation drifts on the UTC-day comparison
  (`packages/api/src/pantry-status.ts`).
- The amber in the ramp is a literal `#e8a308`, deliberately not `var(--accent)`, so a
  re-theme cannot disturb the spoilage language.
- `formatQuantity` is display-only. Round-tripping a formatted value into a PATCH would
  silently corrupt quantities.

**Verification:** `pnpm --filter @diet-app/web test format`

`[Mode: Direct]`

---

## Task 3: Pantry screen

**Files:**
- Create: `packages/web/src/screens/pantry.ts`, `packages/web/src/api/pantry.ts`
- Test: `packages/web/src/__tests__/pantry.test.ts`

**Contracts:**
```ts
// api/pantry.ts
export function listPantry(p?: {limit?: number; offset?: number}): Promise<PantryItem[]>;
export function createPantryItem(body: PantryCreate): Promise<PantryItem>;
export function patchPantryItem(id: string, body: PantryPatch): Promise<PantryItem>;
export function deletePantryItem(id: string): Promise<void>;
export function searchIngredients(q: string): Promise<Ingredient[]>;  // GET /ingredients?q=
```

**Test Cases:**
```ts
it('renders rows in the order the API returned them', () => {
  // API sorts spoilage-first; the client must not re-sort
});
it('renders each row with the API-provided status, not a recomputed one', () => { /* ... */ });
it('filters by location client-side without refetching', () => { /* ... */ });
it('searches ingredients by Finnish alias', async () => {
  // 'peruna' must surface Potato — the API matches aliases[]
});
it('shows the API error message when a create fails', () => { /* ... */ });
it('loads the next page when the list hits the 50-item default limit', () => { /* ... */ });
```

**Constraints:**
- **Never re-sort the list.** `GET /api/pantry` returns spoilage-first order with an id
  tie-break; re-sorting client-side breaks paging consistency.
- Lists are paginated (default 50, max 200). 15 mock items hide this — handle the boundary.
- Phone-first surface: rows `min-height:46px`, controls 26–34px, no hover-only actions.
- Creating an item may omit `expiresDate`; the API derives it from the ingredient's
  shelf-life for that location (`pantry-expiry.ts`). Do not compute it client-side.

**Verification:** `pnpm --filter @diet-app/web test pantry`

`[Mode: Delegated]`

---

## Task 4: Recipes screen (list + detail + servings scaler)

**Files:**
- Create: `packages/web/src/screens/recipes.ts`, `packages/web/src/api/recipes.ts`
- Test: `packages/web/src/__tests__/recipes.test.ts`

**Contracts:**
```ts
export function listRecipes(p?: {tags?: string; cuisine?: string; limit?: number; offset?: number}): Promise<Recipe[]>;
export function getRecipe(id: string, servings?: number): Promise<RecipeWithIngredients>;
// servings → GET /api/recipes/:id?servings=N — the API returns scaled lines
export function patchRecipe(id: string, body: RecipePatch): Promise<Recipe>;
export function forkRecipe(source: RecipeWithIngredients): Promise<Recipe>;
// fork = POST /api/recipes with parentRecipeId: source.id, sourceType: 'forked'
```

**Test Cases:**
```ts
it('refetches with ?servings=N when the scaler changes', async () => {
  // must NOT multiply quantities client-side
});
it('clamps the scaler to 1..12', () => { /* ... */ });
it('shows "base recipe" unchanged and "scaled ×1.5 from 4" when scaled', () => { /* ... */ });
it('tints the source-type label by kind', () => {
  // manual/imported/ai/forked → raised/blue/purple/cyan
});
it('sends multiple tags as one comma-joined ?tags= value', () => {
  // the API ANDs them via array containment
});
it('forks a recipe into a new one carrying parentRecipeId', () => {
  // POST /recipes with sourceType 'forked' — a fork is a new row, not a mutation
});
it('edits a recipe and resends the full ingredient list', () => {
  // recipePatchSchema replaces ingredients wholesale; a partial array drops lines
});
it('scales the displayed quantities but saves the unscaled ones', () => {
  // an edit while the scaler is at ×1.5 must not persist scaled quantities
});
```

**Constraints:**
- **Scaling is server-side.** `GET /api/recipes/:id?servings=N` already scales exactly
  (`recipe-scale.ts`). Reimplementing `qty × target / base` in the client — as the design
  doc describes — creates a second rounding path that will disagree with the deduction the
  cook flow actually applies. Fetch instead; use `formatQuantity` only to display.
- Debounce scaler-driven refetches (~150ms) so holding `+` doesn't storm the API.
- The pantry-availability label per ingredient line (`in pantry` / `expired` / `to buy`)
  needs the pantry list — reuse the cached one; don't refetch per line.
- **`PATCH /recipes/:id` replaces the ingredient list wholesale** — it deletes every
  `recipe_ingredients` row for the recipe and reinserts what you sent. Always submit the
  complete list; sending only the changed lines silently deletes the rest.
- **Never save while scaled.** The scaler is a view concern; an edit submitted at ×1.5 would
  persist scaled quantities as the new base recipe. Edit from the unscaled values.
- `fork` is a create, not a mutation: `POST /recipes` with `parentRecipeId` set and
  `sourceType: 'forked'`. It leaves the source recipe untouched.

**Verification:** `pnpm --filter @diet-app/web test recipes`

`[Mode: Delegated]`

---

## Task 5: Meal plan week grid

**Files:**
- Create: `packages/web/src/screens/plan.ts`, `packages/web/src/api/meal-plans.ts`
- Test: `packages/web/src/__tests__/plan.test.ts`

**Contracts:**
```ts
export function getWeek(mondayIso: string): Promise<MealPlanEntry[]>;  // GET /meal-plans/week/:date
export function createEntry(body: MealPlanCreate): Promise<MealPlanEntry>;
export function patchEntry(id: string, body: MealPlanPatch): Promise<MealPlanEntry>;
export function deleteEntry(id: string): Promise<void>;
```

**Test Cases:**
```ts
it('lays out 7 days × 4 slots in ma..su order', () => {
  // slot is text; the API does not sort it — the client orders breakfast/lunch/dinner/snack
});
it('opens an add-entry affordance from an empty cell', () => { /* not the suggestions screen */ });
it('creates a recipe-backed entry from the picker', () => { /* ... */ });
it('creates a freeform-note entry with no recipe', () => {
  // "Työlounas — canteen" — the API requires recipeId OR freeformNote, never neither
});
it('rejects an add with neither a recipe nor a note before sending', () => { /* ... */ });
it('opens the cook modal from a planned cell', () => { /* ... */ });
it('does not open the cook modal from a cooked cell, and explains why', () => { /* ... */ });
it('reopens a skipped or substituted entry for editing', () => { /* ... */ });
it('keeps the grid horizontally scrollable below 1050px rather than reflowing', () => { /* ... */ });
```

**Constraints:**
- **The client orders slots.** `slot` is text; sorted as text it reads
  breakfast/dinner/lunch/snack. The API deliberately does not sort it.
- **Empty cells must open a real add-entry affordance, not link to AI suggestions.**
  Suggestions are out of scope for this plan; if `+ fill` navigated there, filling a slot
  would be impossible once the demo seed is gone, and the core loop of the whole app would
  have no UI. The design doc's `+ fill → suggestions` link is correct only *after* #380
  lands — until then it points here.
- `mealPlanCreateSchema` requires `recipeId` **or** a non-empty `freeformNote`. Validate that
  client-side; the API returns "Either recipeId or freeformNote is required" otherwise.
- PATCH cannot set `status: 'cooked'` (create can't either) and cannot change `recipeId`,
  `substituteRecipeId` or `servings` on an already-cooked entry.
- The week endpoint is bounded — no pagination.
- `cooked` cells are terminal: click explains the lock, never opens the cook modal.
- Desktop-first: keep `min-width:1050px` inside `overflow-x:auto`; do not restructure the
  grid for narrow viewports.

**Verification:** `pnpm --filter @diet-app/web test plan`

`[Mode: Delegated]`

---

## Task 6: Cook confirm + feedback modals

**Files:**
- Create: `packages/web/src/modals/{cook-confirm.ts,cook-feedback.ts}`
- Create: `packages/web/src/ui/{modal.ts,toast.ts}`
- Test: `packages/web/src/__tests__/cook-flow.test.ts`

**Depends on Task 0.**

**Contracts:**
```ts
export function previewCook(id: string, servings?: number): Promise<CookPlan>;   // Task 0
export function cook(id: string, servings?: number): Promise<CookResult>;
export function saveFeedback(entryId: string, body: FeedbackCreate): Promise<CookFeedback>;
```

**Test Cases:**
```ts
it('renders the deduction table from the preview endpoint', () => { /* ... */ });
it('re-previews when the in-modal servings stepper changes', () => { /* ... */ });
it('renders a shortfall line as "not in pantry — buy first"', () => { /* ... */ });
it('shows the irreversibility warning above the commit button', () => { /* ... */ });
it('opens the feedback modal after a successful cook', () => { /* ... */ });
it('requires changesNote when "changed it" is chosen', () => {
  // usedAsIs === false ⇒ changesNote non-empty, or the API 400s
});
it('omits changesNote entirely when "as-is" is chosen', () => {
  // sending a note alongside usedAsIs:true is a 400, not a silent repair
});
it('lets feedback be skipped without blocking', () => { /* ... */ });
it('surfaces a 409 as "already cooked" and refreshes the entry', () => { /* ... */ });
```

**Constraints:**
- The deduction table comes from the **preview endpoint**, never from client-side FEFO. The
  backend's order is soonest expiry → **opened before unopened** → oldest `createdAt`; the
  design doc omits the opened tiebreak, so lot rows should show `opened` where present.
- Reconcile from the **cook response** after committing — the preview may be stale.
- Modal body uses `flex: 1 1 auto; min-height: 0` — a `1 1 0` basis collapses to zero height
  inside a `max-height`-only modal. The design doc flags this as a verified prototype bug.
- Feedback validation mirrors `mergeFeedback` semantics exactly: a note alongside
  `usedAsIs: true` is an error, not something to quietly drop.
- Toast: schedule the 2600ms timer at the call site and clear the previous one first.

**Verification:** `pnpm --filter @diet-app/web test cook-flow`

`[Mode: Delegated]`

---

## Task 7: Recipe import — paste → extracting → review

**Files:**
- Create: `packages/web/src/screens/import.ts`, `packages/web/src/api/recipe-import.ts`
- Test: `packages/web/src/__tests__/import.test.ts`

**Depends on Task 0b.**

**Contracts:**
```ts
export function extractDraft(input: {url?: string; text?: string}): Promise<RecipeDraft>;
// POST /api/recipes/import — draft only, never inserts
export function confirmRecipe(body: RecipeCreate): Promise<Recipe>;   // POST /api/recipes
```

**Test Cases:**
```ts
it('moves paste → extracting → review on submit', () => { /* ... */ });
it('classifies lines as bound / assumed / unresolved', () => { /* ... */ });
it('blocks save while any line is unresolved', () => {
  // primary disabled + helper-error naming the count
});
it('allows save with assumed lines, but keeps them visibly flagged', () => { /* ... */ });
it('expands an unresolved line into catalog candidates', () => { /* ... */ });
it('skipping a line removes it from the payload entirely', () => { /* ... */ });
it('renders 503 as "AI import is not configured"', () => {
  // the API returns 503 when AI_API_KEY/BASE_URL/MODEL are unset
});
it('renders 502 as a retryable extraction failure', () => { /* ... */ });
it('sends only ingredientId-bound lines to POST /recipes', () => {
  // recipeCreateSchema requires ingredientId per line and >=1 line
});
```

**Constraints:**
- Nothing is saved until the user confirms — the API's import route never inserts.
- The three states map onto the response as: `unresolved` = `match === 'none'` (no catalog
  binding) **or** a line the user has not yet given a quantity; `assumed` =
  `quantityInferred === true` from Task 0b; `bound` = everything else. Do **not** try to
  infer "assumed" from the shape of the number — `match` carries only `exact|alias|none` and
  a round quantity is not evidence of a guess.
- `POST /api/recipes` requires every line to carry a real `ingredientId` and at least one
  line — unresolved lines must be resolved or dropped before submit.
- Creating a brand-new catalog ingredient from this screen is **not supported by the API**
  (no `POST /ingredients`). The `create "Forest mushrooms"` button in the design must either
  be omitted or disabled with a note. Flagged as a follow-up idea, not built here.

**Verification:** `pnpm --filter @diet-app/web test import`

`[Mode: Delegated]`

---

## Task 8: Profile screen

**Files:**
- Create: `packages/web/src/screens/profile.ts`, `packages/web/src/api/profile.ts`
- Test: `packages/web/src/__tests__/profile.test.ts`

**Contracts:**
```ts
export function getProfile(): Promise<UserProfile>;
export function patchProfile(body: ProfilePatch): Promise<UserProfile>;
```

**Test Cases:**
```ts
it('sends only changed fields', () => { /* profilePatchSchema is .strict() */ });
it('rejects an unknown field before sending', () => { /* strict() 400s otherwise */ });
it('sends dislikedIngredientIds as a uuid array', () => { /* junction table, not a column */ });
it('clears a nullable target by sending null, and leaves it alone by omitting it', () => {
  // calorieTargetMin: null clears; absent = unchanged
});
it('states the filter semantics per chip panel', () => {
  // restrictions "hard filter" · disliked "soft — down-weighted" · equipment "gates suggestions"
});
```

**Constraints:**
- `profilePatchSchema` is `.strict()` — an unknown key is a 400. Build the patch from a
  whitelist.
- `dislikedIngredientIds` is not a column; the route writes the junction table separately.
- Empty patch bodies 400 (`requireNonEmpty`) — don't send a no-op save.

**Verification:** `pnpm --filter @diet-app/web test profile`

`[Mode: Direct]`

---

## Task 9: Today screen

**Files:**
- Create: `packages/web/src/screens/today.ts`
- Test: `packages/web/src/__tests__/today.test.ts`

**Depends on Tasks 3–6** (it composes their data and entry points).

**Contracts:** No new API module — composes `listPantry`, `getWeek`, and the cook modal.

**Test Cases:**
```ts
it('shows today\'s four slots with a state-dependent action', () => {
  // cooked+rated → dimmed · cooked+unrated → rate · planned → cook → · empty → fill
});
it('opens the add-entry affordance from an empty slot', () => {
  // same affordance as Task 5 — not the out-of-scope suggestions screen
});
it('lists the five soonest-expiring pantry items', () => { /* ... */ });
it('derives every stat tile from loaded data, with no extra request', () => { /* ... */ });
it('renders each "what now" row as a link to the screen that resolves it', () => { /* ... */ });
it('renders a coherent empty state when the pantry and plan are both empty', () => {
  // the real database currently has 0 recipes and 0 pantry items — this is the first-run view
});
```

**Constraints:**
- Apply the deferred review fixes from idea **#3226** here rather than copying the mockup
  literally: badge counts all mean *needs attention*; drop the redundant `locked` badge in
  favour of a dimmed row; add a quick add-to-pantry action.
- Tiles that need an endpoint this plan does not have (`to buy`) render a muted placeholder,
  not a fabricated number.
- First-run matters: the production database has no recipes and no pantry items today.

**Verification:** `pnpm --filter @diet-app/web test today`

`[Mode: Delegated]`

---

## Task 10: Seed fixtures from the prototype

**Files:**
- Create: `packages/db/scripts/seed-demo.mjs`
- Modify: `packages/db/package.json` (add `seed:demo`)

**Contracts:**
- Idempotent: re-running must not duplicate rows.
- Seeds the design doc's mock data — 15 pantry items, 7 recipes with real ingredient lines
  and steps, one week of meal plan entries — binding every line to a real catalog
  `ingredients.id` by name.
- Refuses to run against a database whose name does not end in `_test` or `_dev` unless
  `--force` is passed.

**Test Cases:**
```ts
it('binds every seeded recipe line to a real catalog ingredient', () => { /* ... */ });
it('is idempotent across two runs', () => { /* ... */ });
it('refuses an unguarded production database name', () => { /* ... */ });
```

**Constraints:**
- Extract the arrays from `docs/plans/assets/ruoka-prototype.dc.html` (`PANTRY`, `RECIPES`).
- Expiry dates in the fixture are *relative* (−1, 0, +1, +2 days…) so the spoilage ramp
  stays meaningful whenever it is seeded — do not hardcode 2026-08 dates.

**Verification:** `pnpm --filter @diet-app/db seed:demo` against `dietapp_test`, then
`psql dietapp_test -c 'select count(*) from recipes'`

`[Mode: Direct]`

---

## Task 11: Deploy — nginx, build hook, docs

**Files:**
- Create: `scripts/post-deploy.sh`
- Modify: `/etc/nginx/sites-enabled/default` (VPS, outside the repo)
- Modify: `CLAUDE.md`

**Contracts:**
- `location /diet/` serves the built static files with SPA fallback (`try_files ... /diet/index.html`).
- `location /diet/api/` keeps its existing proxy block, **placed before** `/diet/` so it
  still wins.
- `/diet/api/health` stays public — carve it out above any auth block.
- `scripts/post-deploy.sh` runs `pnpm --filter @diet-app/web build` and rsyncs `dist/` to
  the served directory. Hook failure aborts the deploy.

**Test Cases:** Manual, and they are the acceptance criteria:
```
xh GET https://mase.fi/diet/                 → 200, HTML
xh GET https://mase.fi/diet/api/health       → 200 {"ok":true}, no credential
xh GET https://mase.fi/diet/pantry           → 200 (SPA fallback, not 404)
xh GET https://mase.fi/diet/api/pantry       → 401 without credential
```

**Constraints:**
- Read `modules/skill/vps-infrastructure.md` before touching nginx.
- Same origin (`/diet/` and `/diet/api/`) means CORS is not involved — do not add origins.
- `deploy` refuses an unclean tree, including untracked files.
- Update `CLAUDE.md`: new `packages/web` workspace, the public URL, and the auth decision.

**Verification:** `scroll-audit https://mase.fi/diet/ --tabs` and
`scroll-audit https://mase.fi/diet/ --viewport 390x844`, then fix every
starved/nested/clipped/noregion finding.

`[Mode: Direct]`

---

## Sequencing

Tasks 0 and 0b are backend, independent of each other, and land first. Then 1 → 2 as the
frontend foundation. Then 3, 4, 5, 8 are independent and parallelisable (distinct screen
files, distinct API modules); 7 joins them once 0b is in. Task 6 needs 0 and 5. Task 9 needs
3–6. Task 10 is independent of all of them. Task 11 is last.

The empty-slot add-entry affordance is built once in Task 5 and reused by Task 9 — it is the
only way to fill a slot until AI suggestions (#380) land, so it is not optional.

## Cross-cutting constraints

- **Never re-derive what the API already returns**: pantry `status`, scaled recipe
  quantities, and the deduction plan all have exactly one authoritative source. Every one
  of them has a client-side reimplementation described in the design doc — all three are
  corrected in the tasks above.
- Lists paginate at 50 (max 200). Every list screen handles the boundary.
- Unit conversion never crosses dimensions — the UI must not offer g→ml.
- Layout verification (`scroll-audit`) is mandatory before commit on any UI change.

---
## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: orchestrator implements directly
- Mode B tasks: Dispatched to subagents
