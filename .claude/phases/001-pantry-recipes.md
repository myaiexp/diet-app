# Phase 1: Pantry + Recipes

> Full CRUD for pantry items and recipe management, with ingredient search and recipe-ingredient linking.

## Goals

- Complete CRUD endpoints for pantry items (add, update, remove, bulk operations)
- Complete CRUD endpoints for recipes (create, edit, delete, with ingredients)
- Ingredient search with fuzzy matching and Finnish alias support
- Auto-compute pantry item expiration status
- Recipe scaling (adjust servings → recalculate ingredient quantities)

## Requirements

_Define what "done" looks like._

- All pantry CRUD endpoints working with validation (Zod schemas)
- All recipe CRUD endpoints working, including recipe-ingredient management
- Auto-deduct pantry items when marking a meal as "cooked"
- Tests for all new endpoints
- Deployed and verified on VPS

## Architecture / Design Notes

- Continue the route pattern from Phase 0: each route file exports `(db: Db) => Hono`
- Add Zod validation schemas for request bodies
- Pantry status computation already exists in GET routes — extend for mutations
- Recipe creation should handle nested recipe_ingredients in a single request

## Notes

_Progress updates, blockers, open questions._
