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
- **Deployment**: Forgejo git hooks (push to deploy), systemd service on VPS
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS, port 3300)
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking
