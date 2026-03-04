# Diet App — Project Initialization Design

> Approved 2026-03-05. Establishes architecture, tech stack, and project structure for the diet app backend. Supersedes tech stack recommendations in `diet-app-plan-techstack-synthesized.md` — all other plan docs (features, data model, AI, phases) remain valid.

---

## Context

The diet app has five synthesized plan documents covering features, data model, phases, AI integration, and tech stack. Those plans assumed a standalone Next.js + Supabase deployment. The actual architecture integrates with the existing central-hub ecosystem:

- **Self-hosted on VPS** (not Vercel/Supabase)
- **Frontend lives in central-hub** (shared React + Vite build)
- **Own PostgreSQL database** (separate from central-hub's DB)
- **Matches central-hub conventions** (Drizzle, Hono, ESM, systemd)

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| **Language** | TypeScript (ES2022, ESM) | Matches central-hub conventions |
| **API Framework** | Hono | Lightweight, TypeScript-native, matches central-hub |
| **Database** | PostgreSQL 16 | Own `dietapp` database on same VPS instance |
| **ORM** | Drizzle | Schema-as-code, typed queries, matches central-hub |
| **Validation** | Zod | Input validation for all API endpoints |
| **AI** | OpenAI-compatible SDK (`openai`) | Configurable base URL + model; provider TBD (likely z.ai GLM-4.7) |
| **Date parsing** | chrono-node | Natural language dates, matches central-hub |
| **Deployment** | systemd + nginx | API as a service, nginx proxies to frontend |
| **Frontend** | React + Vite (in central-hub repo) | Shared with other apps, saves VPS resources |

No auth layer — single-user app, API bound to `127.0.0.1`, only accessible through nginx.

---

## Repo Structure

```
diet-app/
├── packages/
│   ├── db/
│   │   ├── src/
│   │   │   ├── schema/
│   │   │   │   ├── ingredients.ts
│   │   │   │   ├── recipes.ts
│   │   │   │   ├── pantry.ts
│   │   │   │   ├── meal-plans.ts
│   │   │   │   ├── shopping-lists.ts
│   │   │   │   ├── user-profile.ts
│   │   │   │   └── index.ts
│   │   │   ├── connection.ts
│   │   │   ├── seed.ts
│   │   │   └── index.ts
│   │   ├── drizzle/
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── api/
│       ├── src/
│       │   ├── routes/
│       │   │   ├── ingredients.ts
│       │   │   ├── recipes.ts
│       │   │   ├── pantry.ts
│       │   │   ├── meal-plans.ts
│       │   │   ├── shopping-lists.ts
│       │   │   └── profile.ts
│       │   ├── ai/
│       │   │   ├── client.ts
│       │   │   ├── parse-input.ts
│       │   │   ├── import-recipe.ts
│       │   │   ├── generate-meal-plan.ts
│       │   │   ├── suggest-recipes.ts
│       │   │   ├── generate-recipe.ts
│       │   │   ├── adapt-plan.ts
│       │   │   └── weekly-review.ts
│       │   ├── middleware/
│       │   ├── app.ts
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── docs/plans/
├── scripts/
│   └── deploy.sh
├── .env
├── package.json
├── tsconfig.base.json
└── diet-app-plan-*.md
```

**Conventions (matching central-hub):**
- npm workspace monorepo
- ESM with `.js` extensions in imports
- Separate `tsconfig.json` per package extending `tsconfig.base.json`
- `packages/db` is a shared workspace package imported by `packages/api`

---

## Database Schema

### ingredients
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | `defaultRandom()` |
| `name` | text (unique) | Canonical name ("chicken breast") |
| `aliases` | text[] | Alternative names for matching |
| `category` | text | produce, dairy, protein, grain, spice, condiment, frozen, other |
| `default_unit` | text | g, ml, pieces |
| `nutrition_per_100g` | jsonb | `{ calories, protein_g, carbs_g, fat_g, fiber_g }` |
| `shelf_life` | jsonb | `{ fridge_days, freezer_days, pantry_days }` |
| `tags` | text[] | [vegan, gluten-free, high-protein, ...] |
| `is_pantry_staple` | boolean | Default false. Skips tracking + shopping list |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### recipes
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `title` | text | |
| `source_type` | text | user_created, ai_generated, imported |
| `source_url` | text (nullable) | For imported recipes |
| `parent_recipe_id` | uuid (nullable, FK → recipes) | For forks |
| `steps` | jsonb[] | `[{ instruction, timer_minutes? }]` |
| `prep_time` | integer | Minutes of active work |
| `total_time` | integer | Minutes total including passive |
| `servings` | integer | Base yield |
| `effort_score` | integer (1-5) | |
| `tags` | text[] | |
| `cuisine_type` | text (nullable) | |
| `user_rating` | integer (nullable, 1-5) | |
| `times_cooked` | integer | Default 0 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### recipe_ingredients
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `recipe_id` | uuid (FK → recipes) | |
| `ingredient_id` | uuid (FK → ingredients) | |
| `quantity` | numeric | |
| `unit` | text | |
| `optional` | boolean | Default false |
| `notes` | text (nullable) | "diced", "room temperature" |

### pantry_items
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `ingredient_id` | uuid (FK → ingredients) | |
| `quantity` | numeric | |
| `unit` | text | |
| `location` | text | fridge, freezer, pantry, counter |
| `added_date` | date | |
| `expires_date` | date | Auto-set from shelf_life + added_date |
| `opened` | boolean | Default false. Recalculates shelf life |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

`status` (fresh/use_soon/use_today/expired) is computed from `expires_date` vs. today — not stored.

### meal_plan_entries
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `date` | date | |
| `slot` | text | breakfast, lunch, dinner, snack |
| `recipe_id` | uuid (nullable, FK → recipes) | |
| `freeform_note` | text (nullable) | "lunch at restaurant" |
| `servings` | numeric | |
| `status` | text | planned, cooked, skipped, substituted |
| `substitute_recipe_id` | uuid (nullable, FK → recipes) | |
| `notes` | text (nullable) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### cook_feedback
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `meal_plan_entry_id` | uuid (FK → meal_plan_entries, unique) | |
| `rating` | text | thumbs_up, thumbs_down |
| `effort_check` | text | felt_right, too_hard, too_easy |
| `make_again` | text | yes, maybe, no |
| `used_as_is` | boolean | |
| `changes_note` | text (nullable) | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### shopping_lists
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `week_starting` | date | |
| `status` | text | draft, finalized, shopping, done |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

### shopping_list_items
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `list_id` | uuid (FK → shopping_lists) | |
| `ingredient_id` | uuid (FK → ingredients) | |
| `quantity_needed` | numeric | |
| `quantity_in_pantry` | numeric | |
| `net_to_buy` | numeric | `needed - in_pantry`, floored at 0 |
| `category` | text | Inherited from ingredient |
| `bought` | boolean | Default false |
| `custom_note` | text (nullable) | Manual additions |

### user_profile (singleton)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `name` | text | |
| `calorie_target_min` | integer (nullable) | |
| `calorie_target_max` | integer (nullable) | |
| `macro_targets` | jsonb (nullable) | `{ protein_g, carbs_g, fat_g }` as ranges |
| `dietary_restrictions` | text[] | |
| `disliked_ingredient_ids` | uuid[] | |
| `cooking_skill` | text | beginner, competent, enthusiastic |
| `kitchen_equipment` | text[] | |
| `household_size` | integer | Default 1 |
| `schedule_profile` | jsonb | `{ weekday_cook_time, weekend_cook_time, prep_day, overrides }` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

## API Design

Hono API server. Read + write endpoints. Bound to `127.0.0.1:3300`, proxied through nginx.

### Ingredients
```
GET    /api/ingredients              — list/search (?q=chicken&category=protein)
GET    /api/ingredients/:id          — get one
POST   /api/ingredients              — add custom ingredient
```

### Recipes
```
GET    /api/recipes                  — list/filter (?tags=one-pot&maxPrepTime=30&cuisine=italian)
GET    /api/recipes/:id              — full recipe with ingredients + computed nutrition
GET    /api/recipes/pantry-match     — ranked by pantry overlap + urgency
POST   /api/recipes                  — create manually
POST   /api/recipes/import           — import from URL (AI extraction)
PATCH  /api/recipes/:id              — update
POST   /api/recipes/:id/fork         — create personal copy
DELETE /api/recipes/:id              — delete
```

### Pantry
```
GET    /api/pantry                   — all items, sorted by urgency (computed status)
POST   /api/pantry                   — add item(s)
POST   /api/pantry/parse             — smart text input → AI → structured items for confirmation
PATCH  /api/pantry/:id               — update
DELETE /api/pantry/:id               — remove
POST   /api/pantry/bulk-add          — from shopping list completion
```

### Meal Plans
```
GET    /api/meal-plans/week/:date    — get week's plan
POST   /api/meal-plans/generate      — AI generates week
PATCH  /api/meal-plans/:id           — update status, notes
POST   /api/meal-plans/:id/cook      — mark cooked → auto-deduct pantry
POST   /api/meal-plans/:id/feedback  — 3-tap feedback
```

### Shopping Lists
```
GET    /api/shopping-lists/current   — current week's list
POST   /api/shopping-lists/generate  — derive from meal plan - pantry
PATCH  /api/shopping-lists/:id       — update status
PATCH  /api/shopping-lists/items/:id — check off item
POST   /api/shopping-lists/:id/complete — done → trigger pantry bulk-add
```

### Profile
```
GET    /api/profile                  — get user profile
PATCH  /api/profile                  — update settings
```

### Patterns
- Zod validation on all write endpoints
- Computed fields (pantry status, recipe nutrition) calculated in API layer
- AI routes are synchronous (single user, no queue needed)
- Error responses: `{ error: string, details?: any }`

---

## AI Integration

Seven specialized functions using the OpenAI-compatible SDK. Each has a focused system prompt and returns structured JSON.

### Functions

| Function | Route trigger | Model tier | Phase |
|---|---|---|---|
| `parseNaturalInput` | `POST /pantry/parse` | Fast | 1 |
| `importRecipeFromURL` | `POST /recipes/import` | Capable | 1 |
| `generateMealPlan` | `POST /meal-plans/generate` | Capable | 2 |
| `suggestRecipesFromPantry` | `GET /recipes/pantry-match` | Fast | 2 |
| `generateRecipe` | `POST /recipes` (ai source) | Capable | 2 |
| `adaptPlan` | `PATCH /meal-plans/:id` (skip) | Fast | 3 |
| `weeklyReview` | Cron or manual | Capable | 4 |

### Environment config
```env
AI_API_KEY=...
AI_BASE_URL=https://api.z.ai/v1
AI_MODEL_FAST=glm-4-flash
AI_MODEL_CAPABLE=glm-4.7
```

### Constraint solver (generateMealPlan)
- **Hard constraints** (never violate): dietary restrictions, allergies, excluded ingredients
- **Soft constraints** (weighted): pantry urgency (high), schedule fit (high), macro targets (medium), variety (medium), minimize shopping (low)
- **Context**: pantry state sorted by urgency, 2-3 weeks history, schedule profile, pinned meals
- **Output**: structured JSON with reasoning per meal

### Server-side validation
- Parse AI responses with Zod — reject malformed, retry once
- Recalculate nutrition from ingredient data (never trust AI math)
- Verify hard constraints
- Verify referenced ingredients/recipes exist

---

## Deployment

### Database
- `dietapp` database on existing VPS PostgreSQL instance
- Connection string in `.env`

### API service
- systemd: `diet-app-api.service`
- Binds to `127.0.0.1:3300`

### Nginx
- Proxy `/diet/api/` → `localhost:3300`
- Frontend served through central-hub's build

### Deployment script
- Mirrors central-hub's `deploy-mcp.sh` pattern
- Builds packages, syncs to `/opt/diet-app/`, runs migrations, restarts service

### Local development
- SSH tunnel to VPS PostgreSQL (or local PG)
- API runs locally on `localhost:3300`

### Seed data
- ~500 ingredients from USDA FoodData Central
- Nutrition data + shelf lives per storage location
- Run via `npm run seed`

---

## Frontend Integration

1. Register app in central-hub: `register_app(slug="diet", name="Diet Planner", route="/apps/diet", icon="🥗")`
2. Frontend code lives in `central-hub/packages/frontend/` under `/apps/diet`
3. API calls go through nginx to the diet-app API at `/diet/api/`
4. No shared database access — frontend only talks to the diet-app API

The diet-app repo contains zero frontend code. UI work happens in the central-hub repo.

---

## What's superseded from plan docs

| Plan doc recommendation | Actual choice | Why |
|---|---|---|
| Next.js (App Router) | Hono API + central-hub frontend | Frontend shared with other apps on VPS |
| Supabase (managed DB + Auth) | Self-hosted PostgreSQL, no auth | VPS deployment, single-user app |
| Prisma | Drizzle ORM | Matches central-hub conventions |
| Vercel | VPS + systemd + nginx | Self-hosted ecosystem |
| Claude API | OpenAI-compatible SDK | Provider flexibility (likely z.ai GLM-4.7) |
| React Query | TBD | Central-hub frontend concern |
| shadcn/ui + Tailwind | TBD | Central-hub frontend concern |

All other plan doc content (features, data model, AI architecture, phase roadmap) remains valid and unchanged.
