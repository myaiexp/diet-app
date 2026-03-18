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
docs/plans/                            # Archived plan docs
```

Design docs in project root: `diet-app-plan-*.md` (features, data model, phases, AI, tech stack)

## Key Patterns

- **Central-hub conventions**: ESM, `.js` imports, UUID PKs, timezone timestamps
- **Database**: 9 tables — ingredients, recipes, recipeIngredients, pantryItems, mealPlanEntries, cookFeedback, shoppingLists, shoppingListItems, userProfile
- **API**: Each route module exports `(db: Db) => Hono`, mounted in app.ts
- **Deployment**: `scripts/deploy.sh` → build, rsync to VPS, migrate locally via tunnel, restart systemd
- **Dev tunnel**: `npm run dev:tunnel` → SSH port forward 5433→5432 on VPS
- **Public URL**: `https://mase.fi/diet/api/` (nginx proxy on VPS)
- Core concepts: spoilage-first pantry, AI meal planning, constraint satisfaction, auto-deduct cooking

---

## Current Phase

**Phase 1: Pantry + Recipes** — full CRUD for pantry and recipe management

Details: `.claude/phases/current.md`

### Decisions from previous phases

- **Phase 0 (Skeleton)**: Self-hosted on VPS. Hono + Drizzle monorepo. Frontend will be in central-hub. 462 seeded ingredients with nutrition data and Finnish aliases. systemd + nginx deployment.

---

## Doc Management

This project splits documentation to minimize context usage. Follow these rules:

### File layout

| File | Purpose | When to read |
|------|---------|-------------|
| `CLAUDE.md` (this file) | Project identity, structure, patterns, current phase pointer | Auto-loaded every session |
| `.claude/phases/current.md` | Active phase: goals, requirements, architecture, implementation notes | Read when starting phase work |
| `.claude/phases/NNN-name.md` | Archived phases (completed) | Only if you need historical context |

### Phase transitions

When a phase is completed:

1. **Condense** — extract lasting decisions from `.claude/phases/current.md` (architecture choices, patterns established, conventions) and add them to the "Decisions from previous phases" section above. Keep each to 1-2 lines.
2. **Archive** — rename `.claude/phases/current.md` to `.claude/phases/NNN-name.md` (e.g., `001-auth-system.md`)
3. **Start fresh** — create a new `.claude/phases/current.md` from `~/.claude/phase-template.md`
4. **Update this file** — update the "Current Phase" section above
5. **Prune** — remove anything from this file that was phase-specific and no longer applies

### What goes where

- **This file**: project-wide truths (stack, structure, patterns, conventions). Things that are true regardless of which phase you're in.
- **Phase doc**: goals, requirements, architecture decisions, implementation notes, and anything specific to the current body of work.
- **Process rules**: delegation and modularization standards live in `~/.claude/process.md` (global, not per-project).
