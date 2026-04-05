# Diet App Phase 0: Skeleton — Implementation Plan

**Goal:** Stand up the diet-app as a deployable TypeScript monorepo with all database tables, seeded ingredients, and a running API on the VPS.

**Architecture:** npm workspace monorepo with `packages/db` (Drizzle ORM + PostgreSQL) and `packages/api` (Hono). Follows central-hub conventions exactly: ESM, `.js` imports, UUID PKs, timezone timestamps. Separate `dietapp` database on the same VPS PostgreSQL instance. Deployed via systemd + nginx.

**Tech Stack:** TypeScript (ES2022), Drizzle ORM, Hono, PostgreSQL 16, Zod, node-postgres (`pg`)

---

### Task 1: Monorepo Scaffolding [Mode: Direct]

**Files:**
- Create: `package.json` (workspace root)
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore` (add node_modules, dist, .env)

**Contracts:**

Root `package.json`:
```typescript
// name: "diet-app", private: true, workspaces: ["packages/*"]
// scripts: dev:tunnel (ssh -N -L 5433:localhost:5432 vps)
// engines: { node: ">=20" }
```

`tsconfig.base.json` — identical to central-hub:
```typescript
// target: ES2022, module: ESNext, moduleResolution: bundler
// strict: true, declaration: true, sourceMap: true
// outDir: dist, rootDir: src
```

`.env.example`:
```
DATABASE_URL=postgresql://dietapp:password@localhost:5433/dietapp
API_PORT=3300
AI_API_KEY=
AI_BASE_URL=
AI_MODEL_FAST=
AI_MODEL_CAPABLE=
```

`.gitignore` additions: `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`

**Verification:**
```bash
node -e "require('./package.json')" # valid JSON
cat tsconfig.base.json | npx tsx --eval "import('./tsconfig.base.json')" # valid
```

**Commit after completing.**

---

### Task 2: Database Package Setup [Mode: Direct]

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/src/connection.ts`
- Create: `packages/db/src/index.ts`

**Contracts:**

`packages/db/package.json`:
```typescript
// name: "@diet-app/db", type: "module", main: "dist/index.js"
// scripts: build (tsc), generate (drizzle-kit generate), migrate (drizzle-kit migrate), studio, seed
// dependencies: drizzle-orm, pg, dotenv
// devDependencies: drizzle-kit, @types/pg, typescript, tsx
```

`packages/db/src/connection.ts`:
```typescript
export function createDb(connectionString: string): Db
// Uses pg.Pool + drizzle() with schema import
export type Db = ReturnType<typeof createDb>
```

`packages/db/src/index.ts`:
```typescript
// Re-exports: createDb, Db type, all schema tables
```

`drizzle.config.ts` — reads `../../.env`, schema at `./src/schema/index.ts`, out to `./drizzle`

**Verification:**
```bash
cd packages/db && npm run build
```

**Commit after completing.**

---

### Task 3: Database Schema — All Tables [Mode: Delegated]

**Files:**
- Create: `packages/db/src/schema/ingredients.ts`
- Create: `packages/db/src/schema/recipes.ts`
- Create: `packages/db/src/schema/pantry.ts`
- Create: `packages/db/src/schema/meal-plans.ts`
- Create: `packages/db/src/schema/shopping-lists.ts`
- Create: `packages/db/src/schema/user-profile.ts`
- Create: `packages/db/src/schema/index.ts`

**Contracts:**

Every table follows central-hub conventions:
- `uuid('id').primaryKey().defaultRandom()`
- `timestamp('created_at', { withTimezone: true }).notNull().defaultNow()`
- `timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()`
- ESM imports with `.js` extensions
- Foreign keys use `.references(() => table.id)`

**`ingredients` table:**
```typescript
export const ingredients = pgTable('ingredients', {
  id: uuid PK,
  name: text, unique, notNull,
  aliases: text[].default([]),
  category: text notNull,           // produce, dairy, protein, grain, spice, condiment, frozen, other
  defaultUnit: text notNull,        // g, ml, pieces
  nutritionPer100g: jsonb notNull,  // { calories, protein_g, carbs_g, fat_g, fiber_g }
  shelfLife: jsonb notNull,         // { fridge_days, freezer_days, pantry_days } — nullable per location
  tags: text[].default([]),
  isPantryStaple: boolean.default(false),
  createdAt, updatedAt
})
```

**`recipes` table:**
```typescript
export const recipes = pgTable('recipes', {
  id: uuid PK,
  title: text notNull,
  sourceType: text notNull,         // user_created, ai_generated, imported
  sourceUrl: text nullable,
  parentRecipeId: uuid nullable FK → recipes.id,
  steps: jsonb notNull.default([]), // [{ instruction: string, timer_minutes?: number }]
  prepTime: integer nullable,       // minutes
  totalTime: integer nullable,
  servings: integer notNull.default(1),
  effortScore: integer nullable,    // 1-5
  tags: text[].default([]),
  cuisineType: text nullable,
  userRating: integer nullable,     // 1-5
  timesCooked: integer notNull.default(0),
  createdAt, updatedAt
})
```

**`recipeIngredients` join table:**
```typescript
export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid PK,
  recipeId: uuid notNull FK → recipes.id,
  ingredientId: uuid notNull FK → ingredients.id,
  quantity: numeric notNull,
  unit: text notNull,
  optional: boolean.default(false),
  notes: text nullable               // "diced", "room temperature"
})
```

**`pantryItems` table:**
```typescript
export const pantryItems = pgTable('pantry_items', {
  id: uuid PK,
  ingredientId: uuid notNull FK → ingredients.id,
  quantity: numeric notNull,
  unit: text notNull,
  location: text notNull,            // fridge, freezer, pantry, counter
  addedDate: date notNull,
  expiresDate: date notNull,
  opened: boolean.default(false),
  createdAt, updatedAt
})
```

**`mealPlanEntries` table:**
```typescript
export const mealPlanEntries = pgTable('meal_plan_entries', {
  id: uuid PK,
  date: date notNull,
  slot: text notNull,                // breakfast, lunch, dinner, snack
  recipeId: uuid nullable FK → recipes.id,
  freeformNote: text nullable,
  servings: numeric notNull.default(1),
  status: text notNull.default('planned'), // planned, cooked, skipped, substituted
  substituteRecipeId: uuid nullable FK → recipes.id,
  notes: text nullable,
  createdAt, updatedAt
})
```

**`cookFeedback` table:**
```typescript
export const cookFeedback = pgTable('cook_feedback', {
  id: uuid PK,
  mealPlanEntryId: uuid notNull.unique FK → mealPlanEntries.id,
  rating: text notNull,              // thumbs_up, thumbs_down
  effortCheck: text notNull,         // felt_right, too_hard, too_easy
  makeAgain: text notNull,           // yes, maybe, no
  usedAsIs: boolean notNull,
  changesNote: text nullable,
  createdAt, updatedAt
})
```

**`shoppingLists` table:**
```typescript
export const shoppingLists = pgTable('shopping_lists', {
  id: uuid PK,
  weekStarting: date notNull,
  status: text notNull.default('draft'), // draft, finalized, shopping, done
  createdAt, updatedAt
})
```

**`shoppingListItems` table:**
```typescript
export const shoppingListItems = pgTable('shopping_list_items', {
  id: uuid PK,
  listId: uuid notNull FK → shoppingLists.id,
  ingredientId: uuid notNull FK → ingredients.id,
  quantityNeeded: numeric notNull,
  quantityInPantry: numeric notNull.default(0),
  netToBuy: numeric notNull,
  category: text notNull,
  bought: boolean.default(false),
  customNote: text nullable
})
```

**`userProfile` table (singleton):**
```typescript
export const userProfile = pgTable('user_profile', {
  id: uuid PK,
  name: text notNull,
  calorieTargetMin: integer nullable,
  calorieTargetMax: integer nullable,
  macroTargets: jsonb nullable,       // { protein_g, carbs_g, fat_g } as ranges
  dietaryRestrictions: text[].default([]),
  dislikedIngredientIds: uuid[].default([]),
  cookingSkill: text notNull.default('competent'),
  kitchenEquipment: text[].default([]),
  householdSize: integer notNull.default(1),
  scheduleProfile: jsonb notNull.default({}),
  createdAt, updatedAt
})
```

**`schema/index.ts`** — re-exports all tables.

**Drizzle relations** — define in each schema file:
- recipes ↔ recipeIngredients (one-to-many)
- ingredients ↔ recipeIngredients (one-to-many)
- ingredients ↔ pantryItems (one-to-many)
- recipes ↔ mealPlanEntries (one-to-many)
- mealPlanEntries ↔ cookFeedback (one-to-one)
- shoppingLists ↔ shoppingListItems (one-to-many)
- ingredients ↔ shoppingListItems (one-to-many)
- recipes → recipes (self-referential parentRecipeId)

**Test Cases:**
```typescript
// packages/db/src/__tests__/schema.test.ts
// Use vitest

test('ingredients table has correct columns', () => {
  // Verify the table object exports expected column names
  const cols = Object.keys(ingredients);
  expect(cols).toContain('id');
  expect(cols).toContain('name');
  expect(cols).toContain('nutritionPer100g');
  expect(cols).toContain('shelfLife');
  expect(cols).toContain('isPantryStaple');
});

test('all schema tables are exported from index', () => {
  // Import * from schema/index and verify all 9 tables present
  expect(schema.ingredients).toBeDefined();
  expect(schema.recipes).toBeDefined();
  expect(schema.recipeIngredients).toBeDefined();
  expect(schema.pantryItems).toBeDefined();
  expect(schema.mealPlanEntries).toBeDefined();
  expect(schema.cookFeedback).toBeDefined();
  expect(schema.shoppingLists).toBeDefined();
  expect(schema.shoppingListItems).toBeDefined();
  expect(schema.userProfile).toBeDefined();
});

test('foreign keys reference correct tables', () => {
  // Verify recipeIngredients.recipeId references recipes
  // Verify recipeIngredients.ingredientId references ingredients
  // Verify pantryItems.ingredientId references ingredients
  // Verify cookFeedback.mealPlanEntryId references mealPlanEntries
});
```

**Verification:**
```bash
cd packages/db && npm run build && npx vitest run
```

**Commit after passing.**

---

### Task 4: Database Creation + Migration [Mode: Direct]

**Files:**
- Generated: `packages/db/drizzle/` (migration files)

**Steps:**
1. Create `dietapp` database on VPS PostgreSQL:
   ```bash
   ssh vps "sudo -u postgres createdb dietapp"
   ssh vps "sudo -u postgres psql -c \"CREATE USER dietapp WITH PASSWORD 'xxx';\""
   ssh vps "sudo -u postgres psql -c \"GRANT ALL PRIVILEGES ON DATABASE dietapp TO dietapp;\""
   ssh vps "sudo -u postgres psql -d dietapp -c \"GRANT ALL ON SCHEMA public TO dietapp;\""
   ```
2. Set up `.env` with the real DATABASE_URL (through SSH tunnel: `postgresql://dietapp:xxx@localhost:5433/dietapp`)
3. Generate migration: `cd packages/db && npm run generate`
4. Apply migration: `cd packages/db && npm run migrate`

**Verification:**
```bash
ssh vps "sudo -u postgres psql -d dietapp -c '\\dt'" # should show all 9 tables
```

**Commit migration files after verifying.**

---

### Task 5: Ingredient Seed Script [Mode: Delegated]

**Files:**
- Create: `packages/db/src/seed.ts`
- Create: `packages/db/data/ingredients.json` (curated ingredient list)

**Contracts:**

`packages/db/data/ingredients.json` — Pre-processed array of ~500 ingredients:
```typescript
interface SeedIngredient {
  name: string;
  aliases: string[];
  category: 'produce' | 'dairy' | 'protein' | 'grain' | 'spice' | 'condiment' | 'frozen' | 'other';
  defaultUnit: 'g' | 'ml' | 'pieces';
  nutritionPer100g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g: number;
  };
  shelfLife: {
    fridge_days: number | null;
    freezer_days: number | null;
    pantry_days: number | null;
  };
  tags: string[];
  isPantryStaple: boolean;
}
```

**Data sourcing approach:**
- Use USDA FoodData Central Foundation Foods (download JSON/CSV from https://fdc.nal.usda.gov/download-datasets/)
- Extract ~500 most common ingredients with nutrition data
- Supplement with hardcoded shelf-life lookup table by category (USDA doesn't provide shelf life)
- Shelf life defaults by category:
  - produce: fridge 5-7d, freezer 180d, pantry null
  - dairy: fridge 7-14d, freezer 90d, pantry null
  - protein (meat/fish): fridge 2-3d, freezer 180d, pantry null
  - grain: fridge null, freezer null, pantry 365d
  - spice: fridge null, freezer null, pantry 730d
  - condiment: fridge 180d, freezer null, pantry 365d
  - frozen: fridge null, freezer 180d, pantry null
- Finnish aliases for common items (kana=chicken, maito=milk, etc.)
- Tag common items: vegan, vegetarian, gluten-free, high-protein, etc.
- Mark pantry staples: salt, pepper, olive oil, common spices, flour, sugar, etc.

`packages/db/src/seed.ts`:
```typescript
// 1. Read ingredients.json
// 2. Connect to database via createDb()
// 3. Clear existing ingredients (for re-seeding)
// 4. Batch insert all ingredients
// 5. Create default user profile
// 6. Log summary: "Seeded N ingredients, created default profile"
// 7. Exit
```

**Constraints:**
- Batch inserts (not one-by-one) for performance
- Idempotent — safe to run multiple times (truncate + re-insert)
- Must handle the JSON import in ESM (use createRequire or fs.readFileSync + JSON.parse)

**Test Cases:**
```typescript
// packages/db/src/__tests__/seed-data.test.ts

test('ingredients.json is valid and has ~500 entries', () => {
  const data = JSON.parse(readFileSync('data/ingredients.json', 'utf-8'));
  expect(data.length).toBeGreaterThan(400);
  expect(data.length).toBeLessThan(600);
});

test('every ingredient has required fields', () => {
  for (const item of data) {
    expect(item.name).toBeTruthy();
    expect(item.category).toBeTruthy();
    expect(item.defaultUnit).toBeTruthy();
    expect(item.nutritionPer100g.calories).toBeGreaterThanOrEqual(0);
    expect(item.shelfLife).toBeDefined();
  }
});

test('no duplicate ingredient names', () => {
  const names = data.map(i => i.name);
  expect(new Set(names).size).toBe(names.length);
});

test('pantry staples are marked correctly', () => {
  const staples = data.filter(i => i.isPantryStaple);
  expect(staples.length).toBeGreaterThan(20); // salt, pepper, oil, spices, etc.
  const stapleNames = staples.map(i => i.name);
  expect(stapleNames).toContain('salt');
  expect(stapleNames).toContain('black pepper');
  expect(stapleNames).toContain('olive oil');
});
```

**Verification:**
```bash
cd packages/db && npx vitest run
cd packages/db && npm run seed  # against real DB via tunnel
ssh vps "sudo -u postgres psql -d dietapp -c 'SELECT count(*) FROM ingredients;'" # ~500
```

**Commit after passing.**

---

### Task 6: API Package Setup + Health Endpoint [Mode: Direct]

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/app.ts`
- Create: `packages/api/src/index.ts`

**Contracts:**

`packages/api/package.json`:
```typescript
// name: "@diet-app/api", type: "module", main: "dist/index.js"
// scripts: build (tsc), dev (tsx watch src/index.ts), start (node dist/index.js), test (vitest run)
// dependencies: @diet-app/db (workspace:*), @hono/node-server, hono, dotenv, zod
// devDependencies: typescript, tsx, vitest
```

`packages/api/src/app.ts`:
```typescript
export function createApp(db: Db): Hono
// CORS middleware (origin: *)
// Health endpoint: GET /api/health → { ok: true, name: 'diet-app-api' }
// Route mounting points (stubs for now)
```

`packages/api/src/index.ts`:
```typescript
// Load .env from ../../.env
// Create db from DATABASE_URL
// Create app, serve on 127.0.0.1:API_PORT (default 3300)
```

**Test Cases:**
```typescript
// packages/api/src/__tests__/health.test.ts

test('GET /api/health returns ok', async () => {
  // Use Hono's built-in test client (app.request)
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.name).toBe('diet-app-api');
});
```

**Verification:**
```bash
cd packages/api && npm run build
cd packages/api && npx vitest run
cd packages/api && npm run dev  # manual check: curl localhost:3300/api/health
```

**Commit after passing.**

---

### Task 7: API Route Stubs [Mode: Delegated]

**Files:**
- Create: `packages/api/src/routes/ingredients.ts`
- Create: `packages/api/src/routes/recipes.ts`
- Create: `packages/api/src/routes/pantry.ts`
- Create: `packages/api/src/routes/meal-plans.ts`
- Create: `packages/api/src/routes/shopping-lists.ts`
- Create: `packages/api/src/routes/profile.ts`
- Modify: `packages/api/src/app.ts` (mount all routes)

**Contracts:**

Each route module exports a function: `(db: Db) => Hono`

Phase 0 only implements **list** and **get-by-id** endpoints per entity. Full CRUD comes in Phase 1.

**Ingredients routes:**
```typescript
GET /api/ingredients        → list all, optional ?q= search, ?category= filter
GET /api/ingredients/:id    → get one by ID
```

**Recipes routes:**
```typescript
GET /api/recipes            → list all, optional ?tags=, ?cuisine=
GET /api/recipes/:id        → get one with joined recipe_ingredients + ingredient names
```

**Pantry routes:**
```typescript
GET /api/pantry             → list all with computed status field (fresh/use_soon/use_today/expired)
GET /api/pantry/:id         → get one
```

**Meal plans routes:**
```typescript
GET /api/meal-plans/week/:date → get all entries for the week containing :date
```

**Shopping lists routes:**
```typescript
GET /api/shopping-lists/current → get most recent list with items
```

**Profile routes:**
```typescript
GET /api/profile            → get the singleton user profile
```

**Constraints:**
- Pantry items must compute `status` from `expiresDate` vs today: fresh (3+ days), use_soon (2-3 days), use_today (≤1 day), expired (past)
- Recipe GET /:id must join recipe_ingredients and include ingredient names
- All routes return JSON, 404 for missing resources

**Test Cases:**
```typescript
// packages/api/src/__tests__/routes.test.ts
// Use Hono app.request() for testing (no need for running server)
// Mock or use test database

test('GET /api/ingredients returns array', async () => {
  const res = await app.request('/api/ingredients');
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});

test('GET /api/ingredients/:id returns 404 for missing', async () => {
  const res = await app.request('/api/ingredients/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(404);
});

test('GET /api/pantry computes freshness status', async () => {
  // Insert a pantry item with expires_date = tomorrow
  // GET /api/pantry → item should have status: 'use_today'
});

test('GET /api/recipes/:id includes ingredients', async () => {
  // Insert recipe + recipe_ingredients
  // GET /api/recipes/:id → response includes ingredients array with names
});

test('GET /api/meal-plans/week/:date returns correct week', async () => {
  // Insert entries for a specific week
  // GET with a date in that week → returns those entries
  // GET with a date in a different week → returns empty
});
```

**Verification:**
```bash
cd packages/api && npx vitest run
npm run dev  # manual: curl localhost:3300/api/ingredients
```

**Commit after passing.**

---

### Task 8: Deployment Setup [Mode: Direct]

**Files:**
- Create: `scripts/deploy.sh`

**Contracts:**

`scripts/deploy.sh`:
```bash
# 1. Build packages/db and packages/api
# 2. rsync to vps:/opt/diet-app/ (exclude node_modules, src, .env)
# 3. Sync root package.json and tsconfig.base.json
# 4. ssh vps: npm install --omit=dev
# 5. ssh vps: run migrations (cd packages/db && npx drizzle-kit migrate)
# 6. ssh vps: systemctl restart diet-app-api
# 7. Verify: curl localhost:3300/api/health on VPS
```

**VPS setup (manual, done once):**

systemd unit at `/etc/systemd/system/diet-app-api.service`:
```ini
[Unit]
Description=Diet App API
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/diet-app
ExecStart=/usr/bin/node packages/api/dist/index.js
Restart=on-failure
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

VPS `.env` at `/opt/diet-app/.env`:
```
DATABASE_URL=postgresql://dietapp:xxx@localhost:5432/dietapp
API_PORT=3300
```

nginx config addition (in existing server block):
```nginx
location /diet/api/ {
    proxy_pass http://127.0.0.1:3300/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Verification:**
```bash
./scripts/deploy.sh
ssh vps "curl -s localhost:3300/api/health"      # { ok: true }
ssh vps "curl -s localhost:3300/api/ingredients | head -c 200"  # should return JSON array
curl -s https://mase.fi/diet/api/health           # through nginx
```

**Commit after verifying.**

---

### Task 9: Register in Central-Hub + Update Project Docs [Mode: Direct]

**Files:**
- Modify: `CLAUDE.md` (update stack, structure, phase status)
- Modify: `.claude/phases/current.md` (update to reflect Phase 0 → Phase 1 transition)

**Steps:**
1. Register the diet app in central-hub via MCP: `register_app(slug="diet", name="Diet Planner", route="/apps/diet", icon="🥗", status="development")`
2. Update `CLAUDE.md`:
   - Stack section: TypeScript, Hono, Drizzle, PostgreSQL, OpenAI-compatible SDK
   - Structure section: actual monorepo layout
   - Phase: "Phase 1: Pantry + Recipes"
   - Add decision: "Phase 0 — self-hosted VPS, Hono + Drizzle, frontend in central-hub"
3. Update `.claude/phases/current.md` to Phase 1 goals

**Verification:**
```bash
# Verify central-hub registration
ssh vps "curl -s localhost:3200/api/apps" | grep diet
```

**Commit after completing.**

---

## Execution
**Skill:** superpowers:subagent-driven-development
- Mode A tasks (Direct): 1, 2, 4, 6, 8, 9
- Mode B tasks (Delegated): 3, 5, 7
