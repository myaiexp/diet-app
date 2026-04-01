# Diet App

> AI-driven meal planning app with pantry tracking, shopping lists, and nutrition management.

## Stack

- **Language**: TypeScript (ES2022, ESM)
- **Framework**: Hono (API), Drizzle ORM (database)
- **Database**: PostgreSQL 16 (VPS, `dietapp` database)
- **Runtime**: Node.js 20+
- **Monorepo**: npm workspaces

## Project Structure

```
package.json                           # Workspace root
tsconfig.base.json                     # Shared TS config
.env.example                           # Environment template
scripts/deploy.sh                      # Build + rsync + restart
packages/
  db/                                  # @diet-app/db
    src/schema/                        # Drizzle table definitions (9 tables)
    src/connection.ts                  # createDb() factory
    src/seed.ts                        # Seed script (462 ingredients)
    data/ingredients.json              # Seed data
    drizzle/                           # Migration files
    drizzle.config.ts
  api/                                 # @diet-app/api
    src/app.ts                         # Hono app factory
    src/index.ts                       # Server entry point
    src/routes/                        # Route modules (6 files)
```

Design docs in project root: `diet-app-plan-*.md` (features, data model, phases, AI, tech stack)

## Key Patterns

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps
- **Database**: 9 tables — ingredients, recipes, recipeIngredients, pantryItems, mealPlanEntries, cookFeedback, shoppingLists, shoppingListItems, userProfile
- **API**: Each route module exports `(db: Db) => Hono`, mounted in app.ts
- **Deployment**: `scripts/deploy.sh` → build, rsync to `/opt/diet-app`, install deps, restart `diet-app-api.service`
- **Production**: System service `diet-app-api.service` runs as `www-data`, env in `/opt/diet-app/.env`
- **Dev tunnel**: `npm run dev:tunnel` → SSH port forward 5433→5432 on VPS
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy → 127.0.0.1:3300)
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking

---

## Doc Management

- **CLAUDE.md** (this file): Project identity, structure, patterns, conventions
- **`.claude/ideas.md`**: Future feature ideas, tech debt, and enhancements
- **`.claude/plans/`**: Design docs and implementation plans
- **`.claude/references/`**: Domain reference material (specs, external docs, data sources)
- **`.claude/[freeform].md`**: Project-specific context docs (architecture, deployment, etc.)
