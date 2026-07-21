# Phase 1 Closeout Implementation Plan

**Goal:** Ship profile PATCH (+ disliked ingredients), recipe GET scaling via `?servings=`, and draft-only recipe import (text/URL + AI extract + catalog match) to finish Phase 1 roadmap items #376, #240, and #378.

**Architecture:** Three layered slices on the existing Hono + Drizzle API. Profile and scaling follow established write/pure-helper patterns. Import introduces an optional OpenAI-compatible AI client, SSRF-safe URL fetch, and deterministic ingredient matching; import never inserts recipes (client confirms via existing `POST /recipes`).

**Tech Stack:** Hono, Drizzle, Zod 4, Vitest, `openai` SDK (OpenAI-compatible), PostgreSQL `dietapp` / `dietapp_test`.

**Spec:** `docs/plans/2026-07-21-phase1-closeout-design.md` (approved, consensus review clean).

---

## File structure

| Path | Responsibility |
| ---- | -------------- |
| `packages/api/src/responses.ts` | Add `badGateway`, `serviceUnavailable` |
| `packages/api/src/schemas/profile.ts` | Zod PATCH body + calorie cross-field |
| `packages/api/src/routes/profile.ts` | GET with disliked ids; PATCH |
| `packages/api/src/recipe-scale.ts` | Pure `scaleRecipeView` |
| `packages/api/src/routes/recipes.ts` | `?servings=` on GET `:id`; mount import |
| `packages/api/src/config.ts` | `parseAiConfig` |
| `packages/api/src/ai/client.ts` | Build OpenAI client from `AiConfig` |
| `packages/api/src/ai/fetch-url.ts` | SSRF-safe fetch + HTML→text |
| `packages/api/src/ai/import-recipe.ts` | Extract structured recipe via capable model |
| `packages/api/src/ingredient-match.ts` | Exact name/alias → ingredient id |
| `packages/api/src/schemas/recipe-import.ts` | Import body Zod + text max constant |
| `packages/api/src/routes/recipe-import.ts` | `POST /import` |
| `packages/api/src/app.ts` | `AppConfig.ai`; pass into recipe routes |
| `packages/api/src/index.ts` | Wire `parseAiConfig` |
| `packages/api/package.json` | `openai` dependency |
| Tests under `packages/api/src/__tests__/` | Per-module unit + extend `routes.test.ts` |
| `CLAUDE.md` | Point at closeout design/plan |

---

### Task 1: 502/503 response helpers

**[Mode: Direct]**

**Files:**
- Modify: `packages/api/src/responses.ts`
- Test: `packages/api/src/__tests__/responses.test.ts`

**Contracts:**
```ts
export function badGateway(c: Context, error: string): Response  // 502 { error }
export function serviceUnavailable(c: Context, error: string): Response  // 503 { error }
```
Same shape as `conflict` (message only, no details).

**Test Cases:**
```ts
test('badGateway returns 502 and error body')
test('serviceUnavailable returns 503 and error body')
```

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test responses
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 2: Profile PATCH + GET dislikedIngredientIds (#376)

**[Mode: Direct]**

**Files:**
- Create: `packages/api/src/schemas/profile.ts`
- Modify: `packages/api/src/routes/profile.ts`
- Test: `packages/api/src/__tests__/profile.test.ts`
- Optionally extend: `packages/api/src/__tests__/routes.test.ts` (PATCH smoke)

**Contracts:**
- `profilePatchSchema` — `.strict()`; fields per design (nullable only where columns allow; cookingSkill enum; `dislikedIngredientIds` UUID array).
- Empty object after parse → `400` with `formErrors: ['Empty patch body']`.
- Calorie min/max: after merge of existing + patch, if both non-null then `min ≤ max`.
- GET: profile row + `dislikedIngredientIds: string[]`.
- PATCH: no profile → 404; transaction when junction key present; dedupe ids before insert; FK → 400 Invalid reference; bump `updatedAt`; response = GET shape.

**Test Cases:**
```ts
test('GET includes dislikedIngredientIds from junction')
test('GET 404 when no profile')
test('PATCH updates name and householdSize')
test('PATCH null clears calorieTargetMin')
test('PATCH null on name returns 400')
test('PATCH empty body returns 400 Empty patch body')
test('PATCH calorie min > max after merge returns 400')
test('PATCH dislikedIngredientIds full replace')
test('PATCH dislikedIngredientIds empty array clears all')
test('PATCH dislikedIngredientIds dedupes duplicates')
test('PATCH unknown ingredient id returns 400 Invalid reference')
test('PATCH 404 when no profile')
```

**Constraints:**
- Use `userProfile` + `userDislikedIngredients` from `@diet-app/db`.
- Follow pantry/recipe patterns: `readJsonBody`, `badRequest`, `notFound`.
- No create-on-missing.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test profile
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**  
**Roadmap:** Do **not** mark #376 done here — mark all three items in Task 8 after the full closeout is verified.

---

### Task 3: Recipe scaling pure helper + GET ?servings= (#240)

**[Mode: Direct]**

**Files:**
- Create: `packages/api/src/recipe-scale.ts`
- Modify: `packages/api/src/routes/recipes.ts`
- Test: `packages/api/src/__tests__/recipe-scale.test.ts`
- Modify: `packages/api/src/__tests__/recipes.test.ts`

**Contracts:**
```ts
type ScaleResult =
  | { ok: true; recipe: /* deep-copied recipe with scaled lines */ }
  | { ok: false; error: 'invalid_target' | 'invalid_base' };

export function scaleRecipeView(recipe: RecipeWithIngredients, targetServings: number): ScaleResult
```
- Deep-copy; do not mutate input.
- Line `quantity` → `String(round6(Number(qty) * factor))` (string wire shape).
- Set `servings` = target (number), `baseServings` = stored base (number).
- Preserve line ids, units, optional, notes, nested ingredient.
- GET without query: unchanged (no `baseServings`).
- GET with bad query → 400 validation wording (`Invalid servings query` in formErrors or fixed validation).
- GET with bad stored base → 400 `{ error: 'Invalid servings scale' }`.
- No DB write.

**Test Cases:**
```ts
test('scaleRecipeView doubles quantities when target is 2x base')
test('scaleRecipeView returns string quantities')
test('scaleRecipeView does not mutate input')
test('scaleRecipeView invalid_target for 0 / NaN / negative')
test('scaleRecipeView invalid_base when recipe.servings is 0')
test('GET /:id without servings omits baseServings')
test('GET /:id?servings=4 scales lines and sets baseServings')
test('GET /:id?servings=0 returns 400')
test('GET /:id?servings=abc returns 400')
```

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test recipe-scale
build-lock pnpm --filter @diet-app/api test recipes
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 4: parseAiConfig + AppConfig wiring

**[Mode: Direct]**

**Files:**
- Modify: `packages/api/src/config.ts`
- Modify: `packages/api/src/app.ts` (type only / pass-through if needed)
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/__tests__/config.test.ts`
- Modify: `packages/api/package.json` — add `openai` (install via pnpm in packages/api)

**Contracts:**
```ts
export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  modelCapable: string;
};

export function parseAiConfig(env: {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL_CAPABLE?: string;
}): AiConfig | null
```
- Return `AiConfig` only if all three are non-empty after trim; else `null`.
- Do not default `baseUrl` to OpenAI.
- `AppConfig` gains optional `ai?: AiConfig | null`.
- `index.ts` passes `ai: parseAiConfig(process.env)`.
- `recipesRoutes(db, { ai })` (or equivalent) so import can read config — wire signature without requiring import route yet if cleaner to do in Task 7; minimum: config + type + tests here, `openai` dependency installed.

**Test Cases:**
```ts
test('parseAiConfig returns null when any required field missing')
test('parseAiConfig trims and returns config when all present')
test('parseAiConfig ignores AI_MODEL_FAST for readiness')
```

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test config
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 5: Ingredient exact match helper

**[Mode: Direct]**

**Files:**
- Create: `packages/api/src/ingredient-match.ts`
- Test: `packages/api/src/__tests__/ingredient-match.test.ts`

**Contracts:**
```ts
export type MatchKind = 'exact' | 'alias' | 'none';

export type IngredientCandidate = {
  id: string;
  name: string;
  aliases: string[] | null;
};

export type LineMatch = {
  rawName: string;
  ingredientId: string | null;
  match: MatchKind;
};

/** Pure: match one name against an in-memory candidate list. */
export function matchIngredientName(
  rawName: string,
  candidates: IngredientCandidate[],
): LineMatch

/** Load candidates (all or filtered) and match many names. May query DB. */
export async function matchIngredientNames(
  db: Db,
  names: string[],
): Promise<LineMatch[]>
```
- Normalize: trim, collapse whitespace, case-fold compare.
- Prefer name exact over alias exact; stable tie-break (name ASC, id ASC).
- No substring match.

**Test Cases:**
```ts
test('exact name match case-insensitive')
test('alias match when name misses')
test('name exact preferred over alias on another row')
test('none when no match')
test('whitespace normalization')
```

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test ingredient-match
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 6: SSRF-safe URL fetch + HTML strip

**[Mode: Delegated]**

**Files:**
- Create: `packages/api/src/ai/fetch-url.ts`
- Test: `packages/api/src/__tests__/fetch-url.test.ts`

**Contracts:**
```ts
export const IMPORT_TEXT_MAX_CHARS = 100_000; // single shared constant; import schema re-exports or imports this

export type FetchUrlResult =
  | { ok: true; text: string; finalUrl: string; truncated: boolean }
  | { ok: false; error: 'invalid_url' | 'blocked_url' | 'fetch_failed' };

export async function fetchUrlAsText(
  url: string,
  opts?: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number },
): Promise<FetchUrlResult>
```
- Allow only http/https; reject userinfo.
- Block loopback, private, link-local, metadata hosts; re-check redirects (≤5).
- Timeout ~10s; body cap ~1–2 MiB; HTML→text strip scripts/styles/tags; collapse whitespace.
- Truncate to `IMPORT_TEXT_MAX_CHARS` with marker; set `truncated: true`.
- Injectable `fetchImpl` for tests (no real network in CI).

**Test Cases:**
```ts
test('rejects non-http schemes')
test('rejects credentials in URL')
test('rejects loopback host')
test('rejects private IPv4 literal')
test('strips HTML tags to text')
test('truncates oversize text')
test('maps network failure to fetch_failed')
test('blocks redirect to private host')
```

**Constraints:**
- No headless browser.
- Security-first: fail closed on ambiguous hosts.

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test fetch-url
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 7: AI extract + POST /recipes/import (#378)

**[Mode: Delegated]**

**Files:**
- Create: `packages/api/src/ai/client.ts`
- Create: `packages/api/src/ai/import-recipe.ts`
- Create: `packages/api/src/schemas/recipe-import.ts`
- Create: `packages/api/src/routes/recipe-import.ts`
- Modify: `packages/api/src/routes/recipes.ts` — mount import **before** `/:id`
- Modify: `packages/api/src/app.ts` — pass `ai` into recipes
- Test: `packages/api/src/__tests__/import-recipe.test.ts` (extract parse)
- Test: `packages/api/src/__tests__/recipe-import.test.ts` (route)

**Contracts:**
```ts
// client.ts
export function createAiClient(config: AiConfig): OpenAI

// import-recipe.ts
export type ExtractedRecipe = { /* design shape */ };
export async function extractRecipeFromText(
  client: OpenAI,
  model: string,
  text: string,
): Promise<{ ok: true; recipe: ExtractedRecipe } | { ok: false }>

// schema
export const recipeImportBodySchema // XOR url | text; text max IMPORT_TEXT_MAX_CHARS

// route POST /import
// 503 if !ai; 400 validation; url path fetch then extract; text path extract;
// match lines; 200 draft never inserts
```
- Draft response shape per design (`draft` + `unmatchedCount`).
- `sourceType: 'imported'`; `sourceUrl` set for url path else null.
- Defaults: steps `[]`, servings `1`, tags `[]`.
- Use `serviceUnavailable` / `badGateway` / `badRequest`.

**Test Cases:**
```ts
test('503 when ai config null')
test('400 when both url and text')
test('400 when neither url nor text')
test('400 when text exceeds max chars')
test('text path returns draft with matched and unmatched lines')
test('url path uses fetch then extract (mocked)')
test('blocked url returns 400')
test('fetch_failed returns 502')
test('extract failure returns 502')
test('does not call db insert for recipes')
test('unmatchedCount counts none matches')
```

**Constraints:**
- No real AI or outbound network in unit tests — inject mocks.
- Mount path: `POST /api/recipes/import` (literal `import` not UUID).

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test import-recipe
build-lock pnpm --filter @diet-app/api test recipe-import
build-lock tsc --noEmit -p packages/api
```

**Commit after passing.**

---

### Task 8: Integration smoke + docs + roadmap

**[Mode: Direct]**

**Files:**
- Modify: `packages/api/src/__tests__/routes.test.ts` — profile PATCH smoke; optional scale GET; import skipped or 503 without AI
- Modify: `CLAUDE.md` — active plans pointer for phase1 closeout design + plan
- `.env.example` — update the “not yet read by any source file” comment once import/config reads `AI_*`

**Test Cases:**
```ts
test('PATCH /api/profile updates householdSize on real DB')
test('GET /api/recipes/:id?servings=2 returns scaled string quantities')
// import: if no AI env, POST /api/recipes/import → 503
```

**Verification:**
```bash
build-lock pnpm --filter @diet-app/api test
build-lock tsc --noEmit -p packages/api
```

**After verify:**
```bash
helm roadmap status 376 done
helm roadmap status 240 done
helm roadmap status 378 done
```

**Commit after passing.**

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: orchestrator implements directly
- Mode B tasks: Dispatched to subagents

**Order:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (sequential; 5 can parallel 4 after 1; 6 before 7).

**Do not implement in the planning session** — plan commit is the handoff boundary.
