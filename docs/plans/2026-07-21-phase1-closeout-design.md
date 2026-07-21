# Phase 1 Closeout Design — Profile Writes, Recipe Scaling, Recipe Import

**Date:** 2026-07-21  
**Status:** Approved  
**Roadmap:** #376 (user profile write endpoints), #240 (recipe scaling), #378 (recipe import from text or URL)

## Problem

Phase 1's read surface and core write surface (pantry, recipes, meal-plan cook + feedback) are shipped. Three Phase 1 items remain, and they share one theme: finish the API so a human (or a thin client) can configure the household, preview a recipe at N servings, and onboard recipes without hand-typing every ingredient UUID.

They are one closeout slice rather than three unrelated features because:

1. Profile writes unlock the constraint inputs later AI planning will read.
2. Scaling is the read-side counterpart of the scale factor cook already applies on deduct.
3. Import is the primary recipe onboarding path before a frontend exists, and it is the first consumer of a reusable OpenAI-compatible AI client.

## Goals

- `PATCH /api/profile` for singleton profile fields + disliked-ingredients junction.
- Enrich `GET /api/profile` with `dislikedIngredientIds`.
- `GET /api/recipes/:id?servings=N` returns scaled line quantities (no DB write).
- `POST /api/recipes/import` returns a **draft only** (never inserts); client confirms via existing `POST /api/recipes`.
- Server fetches URL content when given a URL (with SSRF guards).
- First real AI client module (OpenAI-compatible, env-driven) for structured recipe extraction.
- Deterministic catalog matching of extracted ingredient names → UUIDs (ILIKE name + aliases).
- Same conventions as existing writes: Zod schemas, `readJsonBody`, shared error helpers, mock unit tests + real-DB smoke where applicable.

## Non-goals

- Persist on import (no insert in the import handler).
- `POST /recipes/:id/fork`, `GET /recipes/pantry-match`, `POST /pantry/parse`.
- AI meal generation / suggestions (#380, Phase 2).
- Density-based mass↔volume conversion (#2593 idea).
- Fuzzy/trigram ingredient search beyond case-insensitive ILIKE on name + aliases.
- Schema migrations or new columns.
- Making `AI_*` env vars required at process boot (only import needs them).
- Rewriting stored recipe quantities when scaling (preview only).
- Multi-user profiles or PUT upsert-create when no profile row exists.

## Locked decisions (from brainstorming)

| Decision | Choice |
| -------- | ------ |
| Import persistence | Two-step draft — import never writes a recipe |
| URL content | Server fetches http(s) URL |
| Scaling surface | `GET /api/recipes/:id?servings=N` (query param; no dedicated path; no persist) |

## Current baseline (verified)

| Surface | State |
| ------- | ----- |
| `GET /api/profile` | Shipped; returns first `userProfile` row or 404; no disliked ids |
| `user_profile` + `user_disliked_ingredients` | Schema + seed default profile (`name: 'Default User'`, `householdSize: 1`, `cookingSkill: 'competent'`) |
| `GET /api/recipes/:id` | Shipped; eager-loads `recipeIngredients` + `ingredient`; no servings query |
| Cook scale | `entry.servings / recipe.servings` inside `POST /meal-plans/:id/cook`; pure `planDeduction` |
| `units.ts` | Mass/volume/count conversion; not required for scaling (scale multiplies quantity, keeps unit) |
| Recipe writes | `POST/PATCH/DELETE /api/recipes` with nested ingredient lines (`sourceType` includes `imported`) |
| AI env | `.env.example` has `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL_FAST`, `AI_MODEL_CAPABLE` — **no source file reads them yet** |
| `openai` package | **Not** in `packages/api` dependencies yet |
| Ingredient search | `GET /api/ingredients?q=` — ILIKE on name + aliases unnest |
| Write conventions | Zod under `schemas/`, `readJsonBody`, `notFound`/`badRequest`/`conflict`, `isUuid`, `isFkViolation` |
| Auth | Bearer on all `/api/*` except health; unit tests omit `authToken` |
| Numeric wire shape | Drizzle `numeric` columns (`recipe_ingredients.quantity`, pantry `quantity`, meal-plan `servings`) read back as **strings** in JSON |
| `responses.ts` | Today: `notFound` / `badRequest` / `conflict` only — no 502/503 helpers yet |

## Architecture

| File | Responsibility | New? |
| ---- | -------------- | ---- |
| `packages/api/src/schemas/profile.ts` | Zod PATCH body | new |
| `packages/api/src/routes/profile.ts` | GET enrich + PATCH | edit |
| `packages/api/src/recipe-scale.ts` | Pure `scaleRecipeLines` / scale full recipe view | new |
| `packages/api/src/routes/recipes.ts` | Optional `?servings=` on GET `:id` | edit |
| `packages/api/src/schemas/recipe-import.ts` | Zod import body | new |
| `packages/api/src/routes/recipe-import.ts` | `POST /import` handler | new |
| `packages/api/src/ingredient-match.ts` | Match extracted names → ingredient rows | new |
| `packages/api/src/ai/client.ts` | OpenAI-compatible client from config | new |
| `packages/api/src/ai/import-recipe.ts` | Prompt + structured extract + parse | new |
| `packages/api/src/ai/fetch-url.ts` | SSRF-safe fetch + HTML→text | new |
| `packages/api/src/config.ts` | `parseAiConfig(env)` next to `parseCorsOrigins` — optional AI config | edit |
| `packages/api/src/responses.ts` | Add thin `badGateway` / `serviceUnavailable` helpers (502/503) for fixed error bodies | edit |
| `packages/api/src/app.ts` | Optional `ai` on `AppConfig`; wire into routes that need it | edit |
| `packages/api/src/index.ts` | `parseAiConfig(process.env)` → pass into `createApp` | edit |
| `packages/api/package.json` | Add `openai` dependency | edit |

Import mounts on the recipes Hono app **before** `/:id` so `import` is not captured as a UUID path param. Prefer mounting from `recipesRoutes` via `app.route('/', recipeImportRoutes(...))` or registering `POST /import` in a dedicated module called from `recipesRoutes` — either way, one mount point under `/api/recipes`.

### Dependency direction

```
routes/recipe-import → ai/import-recipe → ai/client
                     → ai/fetch-url
                     → ingredient-match → db
routes/recipes GET   → recipe-scale (pure)
routes/profile       → schemas/profile
```

Pure modules (`recipe-scale`, match helpers that take candidate lists) stay unit-testable without network or DB. DB-backed match may accept a small lookup function or run queries inside the route after a pure ranker — implementer chooses the split so ranking logic is pure.

## Shared conventions

Inherited unchanged from #236/#237/#379:

| Concern | Behavior |
| ------- | -------- |
| Auth | Bearer on `/api/*` except health; unit tests omit config |
| Path UUID | `isUuid` → `400 { error: 'Invalid id format' }` |
| Body | `readJsonBody` → invalid JSON `400`; Zod fail `400 { error: 'Validation failed', details }` |
| Missing row | `notFound` → `404 { error: 'Not found' }` |
| FK | Prefer pre-check; catch `23503` → `400 { error: 'Invalid reference' }` |
| Content-Type | JSON bodies only |

---

## #376 User profile write endpoints

### GET `/api/profile` (enhance)

Load the singleton via `db.query.userProfile.findFirst()`. Missing → `404`.

Also load junction rows for that profile id and attach:

```jsonc
{
  /* all user_profile columns as today */
  "dislikedIngredientIds": ["uuid", "..."]
}
```

Order of ids is not significant; sort ascending for stable tests optional.

### PATCH `/api/profile`

**No create path.** If no profile row exists → `404`. Seed is responsible for the singleton.

**Body** (`.strict()`, at least one recognized field):

| Field | Type | Notes |
| ----- | ---- | ----- |
| `name` | string | trim, min 1. **NOT NULL** column — omit = unchanged; JSON `null` → `400` (rejected) |
| `calorieTargetMin` | int ≥ 0 \| null | nullable column; `null` clears |
| `calorieTargetMax` | int ≥ 0 \| null | nullable column; `null` clears |
| `macroTargets` | object \| null | nullable column; soft shape (`z.record`); `null` clears — no rigid macro schema in this slice |
| `dietaryRestrictions` | string[] | replace array when present; not null in practice (use `[]`) |
| `cookingSkill` | enum | `beginner` \| `competent` \| `advanced` (DB is free text; Zod constrains writes). **NOT NULL** — omit = unchanged; `null` → `400` |
| `kitchenEquipment` | string[] | replace when present |
| `householdSize` | int ≥ 1 | **NOT NULL** — omit = unchanged; `null` → `400` |
| `scheduleProfile` | object | jsonb **NOT NULL DEFAULT `{}`** — omit = unchanged; JSON `null` → `400` (never write SQL NULL) |
| `dislikedIngredientIds` | UUID[] | **full replace** of junction when key present (empty array = clear all) |

**Null semantics summary:** omitted key = leave column unchanged. JSON `null` is allowed **only** on nullable columns (`calorieTargetMin`, `calorieTargetMax`, `macroTargets`). For NOT NULL columns (`name`, `cookingSkill`, `householdSize`, `scheduleProfile`), `null` is a validation error.

Cross-field: if after merge both calorie min and max are non-null, require `min ≤ max` → else `400 Validation failed`.

Empty patch (no recognized fields after Zod / `.strict()` empty object) → `400 { error: 'Validation failed', details: { formErrors: ['Empty patch body'] } }` — same shape as recipes/pantry/meal-plans.

**Transaction when `dislikedIngredientIds` present:**

1. Update profile columns + `updatedAt`.
2. `DELETE FROM user_disliked_ingredients WHERE user_id = profile.id`.
3. **Dedupe** ingredient ids (preserve first-seen order) before insert so duplicate UUIDs in the array cannot hit composite PK `23505`.
4. Insert new pairs; invalid ingredient UUID → `400 Invalid reference` (pre-check all ids exist, or catch FK via `isFkViolation`).

**Success:** `200` with the same shape as enhanced GET.  
**Errors:** `400` validation / empty patch / calorie order / bad refs; `404` no profile.

### Why not PUT / create-on-missing

Single-user app with a seeded profile. Inventing a profile from a partial PATCH hides misconfigured DBs. PUT would duplicate PATCH for no gain.

---

## #240 Recipe scaling

### Pure helper (`recipe-scale.ts`)

Single exported entry point (internal factor helpers fine but not required by the route):

```ts
type ScaleOk = { ok: true; recipe: ScaledRecipe };
type ScaleErr = { ok: false; error: 'invalid_target' | 'invalid_base' };

function scaleRecipeView(recipe: RecipeWithIngredients, targetServings: number): ScaleOk | ScaleErr
```

Behavior:

1. If `targetServings` is not finite and `> 0` → `{ ok: false, error: 'invalid_target' }`.
2. If stored `recipe.servings` is not finite and `> 0` → `{ ok: false, error: 'invalid_base' }`.
3. `factor = targetServings / recipe.servings`.
4. **Deep-copy** the loaded recipe (do not mutate the object returned from Drizzle). Preserve line `id`, `recipeId`, `ingredientId`, `unit`, `optional`, `notes`, and nested `ingredient` when present.
5. For each line, coerce `quantity` with `Number(...)` (stored numeric may already be a string), multiply by `factor`, round to 6 decimal places (same spirit as private `round6` in `cook-deduct.ts` — export a shared round helper or duplicate the one-liner), and set **`quantity` back to a string** (`String(rounded)`) so the JSON wire shape stays consistent with unscaled GET (`"500"` not `500`).
6. Set response `servings` to the **number** `targetServings` (column is integer). Set `baseServings` to the stored integer base. Leave all other header fields unchanged.

### `GET /api/recipes/:id?servings=N`

| Query | Behavior |
| ----- | -------- |
| omitted | Current behavior — stored recipe as today. **Do not** add `baseServings`. List GET and unscaled GET `:id` remain byte-compatible with today's shape (string quantities, no extra fields). |
| present | Parse/coerce query to number. Call `scaleRecipeView`. `invalid_target` → `400 { error: 'Validation failed', details: { formErrors: ['Invalid servings query'] } }` (or equivalent fixed validation wording — bad **query**, not bad stored data). `invalid_base` → `400 { error: 'Invalid servings scale' }` (aligned with cook's domain message for a bad stored base). On success return the scaled copy. |

**No DB write.** List GET (`GET /`) does not scale.

Cook path remains the authority for pantry deduction scale (`entry.servings / recipe.servings`).

---

## #378 Recipe import (draft only)

### `POST /api/recipes/import`

Mount under `/api/recipes` as `POST /import` (literal path before `/:id`).

#### Request body

Exactly one of:

| Field | Notes |
| ----- | ----- |
| `url` | Absolute `http:` or `https:` URL string |
| `text` | Non-empty string (trimmed min 1); **max length same as model input cap** (see below) |

Zod refine: XOR — not both, not neither.

**Text size cap:** After trim, `text` must be ≤ the same character budget applied to URL-derived text before the model (implement as one constant, e.g. `IMPORT_TEXT_MAX_CHARS = 100_000`). Oversize paste → `400 { error: 'Validation failed', ... }` (reject, do not silently truncate). URL-fetched text that exceeds the cap **is** truncated with an explicit truncation marker before the model (fetch path only — caller cannot control page size).

#### AI configuration

`parseAiConfig(env)` in `config.ts` (same style as `parseCorsOrigins`). **Configured only when all three are non-empty after trim:**

| Env | Role |
| ---- | ---- |
| `AI_API_KEY` | API key |
| `AI_BASE_URL` | OpenAI-compatible base URL (e.g. z.ai or xAI) — **required**; do not fall through to the SDK's default OpenAI host |
| `AI_MODEL_CAPABLE` | Model id for extraction |
| `AI_MODEL_FAST` | Optional; unused in this slice — ignored by `parseAiConfig` readiness |

If any of the three required vars is missing/empty → return `null`. `createApp` receives `ai: null | AiConfig`. Import handler: when `ai` is null → **`503`** via `serviceUnavailable(c, 'AI not configured')`. Server still boots; all non-AI routes work. Unit tests inject a mock `ai` or stub extract.

Add dependency: `openai` (official SDK) in `packages/api`.

#### URL fetch (`ai/fetch-url.ts`)

1. Parse URL; allow only `http:` and `https:`.
2. Reject userinfo (credentials in URL).
3. Resolve hostname; **block** loopback, link-local, private IPv4 ranges, unique-local IPv6, metadata hostnames (`169.254.169.254`, `metadata.google.internal`, etc.). Prefer block-on-resolve after DNS to reduce DNS-rebinding risk; if full rebinding defense is heavy, document "resolve once + connect to that address" as the implementer's minimum.
4. Timeout ~10s; max response body ~1–2 MiB; limit redirects (e.g. ≤5), re-validate each hop against the same SSRF rules.
5. `Content-Type` preferably HTML/text; still attempt strip on unknown types if body is text-like.
6. HTML → plain text: strip scripts/styles/tags, collapse whitespace. No headless browser.
7. Cap extracted text length before the model using `IMPORT_TEXT_MAX_CHARS` with a clear truncation marker when truncated.

Failures: invalid/blocked URL → `400`; network/timeout → `badGateway(c, 'Failed to fetch URL')` → `502`.

#### AI extraction (`ai/import-recipe.ts`)

- Model tier: **capable** (`AI_MODEL_CAPABLE`).
- System prompt: extract one recipe as JSON only; no markdown fences; fields listed below.
- Prefer structured output / JSON mode if the provider supports it via the OpenAI SDK; otherwise instruct JSON-only and parse robustly (strip fences if present).
- Server validates with Zod after parse. **Never** trust model arithmetic or IDs.

Extracted shape (internal, before match):

```ts
{
  title: string;                 // required non-empty
  steps: string[];               // default []
  servings?: number;             // positive int if present
  prepTime?: number | null;      // minutes
  totalTime?: number | null;
  cuisineType?: string | null;
  tags?: string[];
  effortScore?: number | null;   // 1–5 if present
  ingredients: Array<{
    name: string;                // required — raw food name
    quantity: number;            // positive
    unit: string;                // non-empty
    optional?: boolean;
    notes?: string | null;
  }>;                            // min 1 after validation
}
```

If the model returns zero ingredients or missing title → treat as extraction failure → `badGateway(c, 'Recipe extraction failed')` (`502`).

#### Ingredient match (`ingredient-match.ts`)

For each extracted `name`:

1. Normalize: trim, collapse internal whitespace, case-fold for comparison.
2. Candidates: query ingredients where `name ILIKE` exact equality (use `lower(name) = lower($name)` or equivalent) **or** alias exact match via unnest.
3. Prefer **name exact** over **alias exact**. If multiple name exact (shouldn't happen), pick stable order (e.g. name ASC, id ASC) and take first.
4. No substring/fuzzy match in this slice — reduces false positives ("salt" matching "basalt" is not a risk with exact; substring would be).
5. Result per line: `match: 'exact' | 'alias' | 'none'` and `ingredientId: uuid | null`.

Matching is deterministic and DB-backed; not an LLM second pass.

#### Success response `200`

Never inserts into `recipes` / `recipe_ingredients`.

```jsonc
{
  "draft": {
    "title": "…",
    "sourceType": "imported",
    "sourceUrl": "https://…" /* or null for text import */,
    "steps": ["…"],
    "servings": 4,
    "prepTime": 15,
    "totalTime": 45,
    "effortScore": null,
    "tags": [],
    "cuisineType": null,
    "ingredients": [
      {
        "rawName": "kananmuna",
        "ingredientId": "uuid-or-null",
        "quantity": 2,
        "unit": "kpl",
        "optional": false,
        "notes": null,
        "match": "exact"
      }
    ]
  },
  "unmatchedCount": 0
}
```

`unmatchedCount` = count of lines with `match === 'none'`.  
Defaults when model omits optional fields: `steps: []`, `servings: 1` (match recipe create default), empty tags, null times. Draft line `quantity` is a **number** in the draft payload (client will send numbers into create Zod which coerces); this is a draft DTO, not a Drizzle row — string wire shape applies to persisted recipe GET only.

Client maps matched lines into `POST /api/recipes` (drop or fix unmatched first). Draft field names align with create schema where possible (`title`, `steps`, `servings`, `ingredients` with `ingredientId`/`quantity`/`unit`/…).

#### Error table

| Case | Status | Helper / body |
| ---- | ------ | ------------- |
| Invalid JSON / Zod / XOR url\|text / text too long | 400 | `badRequest` — Validation failed / Invalid JSON body |
| AI not configured (any of key/base/model missing) | 503 | `serviceUnavailable(c, 'AI not configured')` |
| Blocked or invalid URL | 400 | `badRequest(c, 'Invalid or blocked URL')` |
| Fetch failed / timeout | 502 | `badGateway(c, 'Failed to fetch URL')` |
| AI call failed / unparseable / empty recipe | 502 | `badGateway(c, 'Recipe extraction failed')` |

Add `badGateway` and `serviceUnavailable` to `responses.ts` alongside existing helpers (same `{ error: string }` shape).

---

## Testing strategy

| Area | Tests |
| ---- | ----- |
| Profile | Mock: GET with disliked ids; PATCH fields; disliked full replace + clear; empty body; calorie min>max; 404; FK bad ingredient |
| Scale | Pure unit: factors, rounding, bad base/target; route: `?servings=` scales quantities, omits write, invalid query 400 |
| Match | Unit: exact name, alias, none; priority name over alias |
| Fetch URL | Unit: reject private IPs, reject non-http, allow public shape (mock DNS/fetch if needed) |
| Import | Mock AI + mock fetch: text path draft; url path; 503 without AI; no DB insert; unmatchedCount |
| Integration (`routes.test.ts`) | Profile PATCH smoke against `dietapp_test`; import optional/skipped without keys |

Do not call real external AI or arbitrary URLs in CI.

## Implementation order

1. Profile schema + PATCH + GET disliked + tests → closes #376  
2. `recipe-scale` pure + GET `?servings=` + tests → closes #240  
3. AI config + `openai` client scaffold (no route yet)  
4. Ingredient match helper + tests  
5. URL fetch SSRF helper + tests  
6. Import extract + `POST /import` + tests → closes #378  
7. Docs: `CLAUDE.md` pointer; mark roadmap items done after verify  

## Alternatives considered

| Topic | Rejected option | Why |
| ----- | --------------- | --- |
| Import write | One-shot persist / persist-if-matched | User chose two-step draft; reuses create validation; no junk rows |
| URL content | Client-only paste | User chose server fetch; better for CLI/curl before frontend |
| Scaling API | Dedicated `/scale` or persist rebase | Query param is enough; cook already uses entry servings for deduct |
| AI boot | Require keys at startup | Would break deploys/tests without AI; only import needs it |
| Match | LLM second pass / substring ILIKE | Deterministic exact match is safer for the seed catalog (~400–500 ingredients) |
| Profile | PUT create-on-missing | Seed owns singleton; hide missing seed less |
| Provider lock-in | Hardcode one vendor | Project-init already uses `AI_BASE_URL` + OpenAI-compatible SDK |

## Deferred (not in this design)

Capture as Helm ideas if not already filed:

- Fuzzy / pg_trgm ingredient match for import  
- LLM-assisted ingredient resolution when exact match fails  
- `POST /recipes/:id/fork`  
- Persist-on-import convenience flag  
- Recipe import caching by URL  
- Headless/JS-rendered page fetch for JS-heavy recipe sites  
- `parseNaturalInput` for pantry (`POST /pantry/parse`)  
- Density table for mass↔volume (existing idea #2593)  
- Stricter typed `macroTargets` / `scheduleProfile` schemas once UI exists  
- Prompt versioning for AI functions  
