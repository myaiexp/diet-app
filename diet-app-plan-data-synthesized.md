# Data Models — Synthesized Plan

## Design Principles

- **Ingredient as canonical concept**: Everything references a shared ingredient entity, not store-specific or recipe-specific names.
- **Pantry staples handled gracefully**: Ingredients like salt, olive oil, and common spices are tagged as `pantry_staple` and excluded from precise quantity tracking and shopping list calculations.
- **Bootstrap with real data**: Seed ~500 common ingredients from USDA FoodData Central or Open Food Facts. Allow user additions and AI-proposed ingredients.
- **Discrete over continuous**: Use simple, human-readable statuses (not decaying floats) for freshness tracking.
- **Recipes are forkable**: Modifying a recipe creates a personal version while preserving the original.

---

## Entities

### Ingredient

The atomic unit. Every recipe, pantry item, and shopping list item references this.

| Field                 | Type             | Purpose                                                                        |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `id`                  | UUID             | Primary key                                                                    |
| `name`                | string           | Canonical name (e.g., "chicken breast")                                        |
| `aliases`             | string[]         | Alternative names for matching (e.g., "pollo", "kananrinta")                   |
| `category`            | enum             | produce, dairy, protein, grain, spice, pantry_staple, frozen, condiment, other |
| `default_unit`        | enum             | grams, ml, pieces — whatever makes sense for this ingredient                   |
| `nutrition_per_100g`  | object           | `{ calories, protein_g, carbs_g, fat_g, fiber_g }`                             |
| `typical_shelf_life`  | object           | `{ fridge_days, freezer_days, pantry_days }` — nullable per location           |
| `tags`                | string[]         | Flexible: `[vegan, gluten-free, nightshade, high-protein, ...]`                |
| `season_availability` | string[] or null | Months when locally available (optional, useful for seasonal suggestions)      |
| `is_pantry_staple`    | boolean          | If true, skip precise quantity tracking and shopping list generation           |

**Notes:**

- `is_pantry_staple` covers salt, pepper, olive oil, common spices — things you always have and never precisely measure. These are assumed available unless the user explicitly marks them out of stock.
- `aliases` enable fuzzy matching when importing recipes or logging ingredients.

---

### Recipe

| Field               | Type           | Purpose                                                                           |
| ------------------- | -------------- | --------------------------------------------------------------------------------- |
| `id`                | UUID           | Primary key                                                                       |
| `title`             | string         | Recipe name                                                                       |
| `source`            | enum + string  | `user-created`, `ai-generated`, `imported` + optional URL/reference               |
| `parent_recipe_id`  | UUID or null   | If this is a fork of another recipe, reference the original                       |
| `ingredients`       | array          | `[{ ingredient_id, quantity, unit, optional: bool }]`                             |
| `steps`             | array          | Ordered instructions (text + optional timer in minutes)                           |
| `prep_time`         | integer        | Minutes of active hands-on work                                                   |
| `total_time`        | integer        | Including passive time (oven, marinating, resting)                                |
| `servings`          | integer        | Base yield                                                                        |
| `complexity`        | 1–5            | Can be auto-derived from step count + technique tags                              |
| `tags`              | string[]       | `[meal-prep-friendly, one-pot, 30-min, comfort-food, freezable, ...]`             |
| `cuisine_type`      | string or null | Italian, Finnish, Mexican, etc.                                                   |
| `nutrition_summary` | object         | Auto-calculated from ingredients: `{ calories, protein, carbs, fat }` per serving |
| `user_rating`       | 1–5 or null    | Set after cooking                                                                 |
| `times_cooked`      | integer        | Engagement signal — incremented when meal plan entry marked as cooked             |
| `created_at`        | timestamp      |                                                                                   |

**Key decisions:**

- `optional: bool` on ingredients means "add if you have it" — e.g., fresh herbs, garnishes. These don't block recipe suggestions when missing from pantry.
- `parent_recipe_id` enables forking: modify an AI suggestion or imported recipe, and it becomes yours while the original stays intact.
- `nutrition_summary` is always derived, never manually entered. Recalculates when ingredients change.

---

### Pantry Item

An instance of an Ingredient that's currently in the user's kitchen.

| Field           | Type    | Purpose                                                             |
| --------------- | ------- | ------------------------------------------------------------------- |
| `id`            | UUID    | Primary key                                                         |
| `ingredient_id` | UUID    | Links to canonical ingredient                                       |
| `quantity`      | number  | How much you have (in the ingredient's default unit)                |
| `location`      | enum    | `fridge`, `freezer`, `pantry`, `counter`                            |
| `added_date`    | date    | When it entered the kitchen                                         |
| `expires_date`  | date    | Auto-set from `typical_shelf_life` + `added_date`, user-overridable |
| `opened`        | boolean | Affects shelf life calculation (opened milk spoils faster)          |
| `status`        | enum    | `fresh`, `use_soon`, `use_today`, `expired` — derived from dates    |

**Notes:**

- `status` is computed, not stored: compare `expires_date` against today. `use_soon` = within 2 days, `use_today` = today or tomorrow, `expired` = past expiry.
- When `opened` flips to true, `expires_date` can auto-recalculate using a shorter shelf life (e.g., opened milk: 5 days instead of 14).
- Pantry staples (salt, oil, spices) can exist here but with `quantity` treated as approximate. The app won't nag about running low unless the user explicitly sets a threshold.

---

### Meal Plan Entry

| Field                  | Type           | Purpose                                                         |
| ---------------------- | -------------- | --------------------------------------------------------------- |
| `id`                   | UUID           | Primary key                                                     |
| `date`                 | date           | Which day                                                       |
| `slot`                 | enum           | `breakfast`, `lunch`, `dinner`, `snack`                         |
| `recipe_id`            | UUID or null   | Nullable — sometimes you eat out or eat something untracked     |
| `freeform_note`        | string or null | For untracked meals: "lunch at restaurant", "leftover pizza"    |
| `servings`             | number         | How many portions (enables leftover planning)                   |
| `status`               | enum           | `planned`, `cooked`, `skipped`, `substituted`                   |
| `substitute_recipe_id` | UUID or null   | If status is `substituted`, what was actually cooked            |
| `notes`                | string or null | Post-meal notes: "used turkey instead of chicken", "made extra" |

**Notes:**

- `freeform_note` replaces a rigid "freeform meal" type — just a nullable text field when no recipe is involved.
- Tracking `servings` enables leftover math: cook 4 servings, eat 1, the system knows 3 are available for future meals.

---

### Shopping List

A first-class entity, not just a derived view. Users interact with it directly.

| Field           | Type      | Purpose                                  |
| --------------- | --------- | ---------------------------------------- |
| `id`            | UUID      | Primary key                              |
| `week_starting` | date      | Which week this list covers              |
| `status`        | enum      | `draft`, `finalized`, `shopping`, `done` |
| `items`         | array     | See below                                |
| `created_at`    | timestamp |                                          |

**Shopping List Item:**

| Field                | Type    | Purpose                                               |
| -------------------- | ------- | ----------------------------------------------------- |
| `ingredient_id`      | UUID    | What to buy                                           |
| `quantity_needed`    | number  | Total required by meal plan                           |
| `quantity_in_pantry` | number  | What's already available                              |
| `net_to_buy`         | number  | `quantity_needed - quantity_in_pantry` (floored at 0) |
| `category`           | string  | Inherited from ingredient — used for aisle grouping   |
| `bought`             | boolean | Check off while shopping                              |

**Notes:**

- Generated from the week's meal plan minus current pantry stock.
- Pantry staples are excluded unless the user has explicitly flagged one as "out of stock."
- `category` grouping makes the list usable in a store (all produce together, all dairy together, etc.).

---

### User Profile

Single-user app, so this is effectively a settings/config entity.

| Field                  | Type           | Purpose                                                  |
| ---------------------- | -------------- | -------------------------------------------------------- |
| `name`                 | string         | For display                                              |
| `daily_calorie_target` | range or null  | e.g., 1800–2200 (range, not fixed number)                |
| `macro_targets`        | object or null | `{ protein_g, carbs_g, fat_g }` as ranges or percentages |
| `dietary_restrictions` | string[]       | Allergies, intolerances, ethical exclusions              |
| `disliked_ingredients` | UUID[]         | Ingredient IDs to always exclude                         |
| `cooking_skill_level`  | enum           | `beginner`, `competent`, `enthusiastic`                  |
| `kitchen_equipment`    | string[]       | `[oven, stovetop, instant_pot, air_fryer, blender, ...]` |
| `household_size`       | integer        | Default servings multiplier                              |
| `weekly_budget`        | number or null | Optional constraint for shopping list generation         |
| `schedule_profile`     | object         | See below — per-day complexity and time budgets          |

**Schedule Profile (embedded in User Profile):**

| Field                       | Type        | Purpose                                                                  |
| --------------------------- | ----------- | ------------------------------------------------------------------------ |
| `default_weekday_cook_time` | integer     | Minutes available for cooking on a typical weekday                       |
| `default_weekend_cook_time` | integer     | Minutes available on weekends                                            |
| `prep_day`                  | day or null | Preferred day for bulk prep (e.g., Sunday)                               |
| `day_overrides`             | object      | Per-day exceptions: `{ "monday": { cook_time: 20, complexity_max: 2 } }` |

**Notes:**

- Schedule profile is intentionally simple for now. The lifestyle complexity you identified (WFH days, gym days, seasonal work, contract variability) needs deeper modeling — flagged as a **Phase 3 decision point**. Options include: day-type templates, weekly schedule presets, or a more dynamic context system.
- `daily_calorie_target` as a range (not a single number) reflects how nutrition actually works — you don't need to hit exactly 2000 every day.

---

## Open Questions for Phase 3

1. **Lifestyle context modeling**: How should WFH days, gym days, seasonal work patterns, and variable schedules be represented? Options:
   - Day-type templates (e.g., "WFH day", "gym day", "office day" with different defaults)
   - Weekly schedule presets that can be swapped seasonally
   - A simple override system where you tag specific dates
   - Some combination

2. **Flavor/cuisine preferences**: Sonnet included `flavor_profile` (spicy tolerance, texture preferences). Worth adding to User Profile or let the AI learn from ratings?

3. **Ingredient quantity precision**: For non-staple ingredients, how precise should pantry tracking be? Options range from exact grams to rough categories (full, half, low, out).

4. **Recipe diet compatibility**: Should recipes explicitly store `diet_compatibility[]` tags, or derive compatibility from ingredient tags at query time?
