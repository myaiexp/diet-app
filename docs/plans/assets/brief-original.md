# Diet App — frontend design brief

Design the frontend for a single-user meal-planning app. The backend is already
built and deployed; I need the UI.

Build it as **plain HTML + CSS + vanilla JS** — no React, no Tailwind, no
component framework. The real implementation is vanilla TypeScript + Vite, so a
framework mockup would have to be thrown away. Use static mock data inline; do
not call the real API.

---

## Design system — do not invent one

Load my shared stylesheet and build on top of it:

```html
<link rel="stylesheet" href="https://mase.fi/base.css">
```

It defines every token and base component. Use them; don't override the look.

**The aesthetic is deliberate — please don't "improve" it toward a conventional
consumer app.** No rounded corners, no cards with drop shadows, no pastel
gradients, no big hero images, no emoji, no illustration. It is a dense,
text-first, terminal-flavoured interface. Think IRC client or a well-made TUI,
not a recipe blog.

- **Background** `--bg` `#09090b` (AMOLED black), layering up through
  `--bg-surface` `#131316` → `--bg-raised` `#18181c` → `--bg-hover` `#27272a`
- **Text** `--text` → `--text-dim` → `--text-muted`
- **Borders** `--border` `#27272a`, `--border-hover` `#3f3f46`
- **Accent** `--accent` `#e8a308` (amber). For this project override it to a
  food-appropriate hue if you have a strong opinion — propose one, don't just
  silently swap it.
- **Semantic** `--green #22c55e`, `--red #ef4444`, `--orange #d29922`,
  `--blue #58a6ff`, `--cyan #06b6d4`, `--purple #bc8cff` (each has a matching
  `--*-bg` translucent fill)
- **Type** JetBrains Mono for *everything*. Sizes: `--text-xs 10px`,
  `--text-sm 11px`, `--text-base 12px`, `--text-md 13px`, `--text-lg 15px`
- **`--radius: 0`** — sharp edges everywhere
- Tight spacing, minimal padding, high information density

Existing base.css components you should reuse rather than rebuild: labels/badges,
buttons (`.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.btn-sm`), form
inputs, section headers, modals, toasts, status dots, `<base-select>`.

**For card grids use the `.card-grid` class and set `--card-min`** (default
260px). Don't hand-roll `repeat(auto-fill, minmax(280px, 1fr))` — a bare minmax
floor is a hard minimum and overflows the viewport on narrow screens.

### Responsive priorities

This is not equally a desktop and mobile app — different screens have different
homes, and I'd rather you optimise each than make everything uniformly mediocre:

- **Phone-first** (used standing in a shop or at the counter): Shopping List,
  Pantry, Cook flow. Big tap targets, one column, no hover-dependent actions.
- **Desktop-first** (used while sitting down planning): Meal Plan week grid,
  Recipe import, Profile. These can be dense and multi-column.

Target Android Firefox for mobile. Assume 390×844.

---

## The app

Spoilage-first meal planning. The core loop:

1. I stock the **pantry** with what I actually have, and each item has an expiry.
2. I keep a **recipe** collection, imported from URLs or typed in.
3. I fill a weekly **meal plan** — ideally suggested by AI, prioritising
   ingredients about to spoil.
4. Missing ingredients become a **shopping list** (needed minus what's in the
   pantry).
5. When I cook an entry, the ingredients are **auto-deducted** from the pantry
   (oldest-expiring first), and I leave quick **feedback** that tunes future
   suggestions.

Single user, no login screen, no onboarding, no marketing pages. It opens
straight into the app.

---

## Data model

These are the real field names and the real allowed values. Please use them
exactly — it makes the mockup a usable spec rather than a repaint.

**Ingredient** (462 already seeded, incl. Finnish aliases — `potato`/`peruna`)
- `name`, `aliases[]`, `category`, `defaultUnit`, `tags[]`, `isPantryStaple`
- `category`: `produce` `protein` `spice` `condiment` `grain` `dairy` `frozen` `other`
- `nutritionPer100g`: `{ calories, protein_g, carbs_g, fat_g, fiber_g }`
- `shelfLife`: `{ fridge_days, pantry_days, freezer_days }` (any may be null)

**Pantry item**
- `ingredientId`, `quantity`, `unit`, `location`, `addedDate`, `expiresDate`, `opened`
- `location`: `fridge` `freezer` `pantry` `counter`
- Derived `status`: `fresh` `use_soon` (≤3d) `use_today` (≤1d) `expired`
  — this drives the whole app's colour language; give it a strong visual treatment

**Recipe**
- `title`, `sourceType`, `sourceUrl`, `steps[]` (array of strings), `prepTime`,
  `totalTime`, `servings`, `effortScore` (1–5), `tags[]`, `cuisineType`,
  `userRating`, `timesCooked`
- `sourceType`: `manual` `imported` `ai` `forked`
- Ingredient lines: `{ ingredientId, quantity, unit, optional, notes }`

**Meal plan entry**
- `date`, `slot`, `recipeId` *or* `freeformNote`, `servings`, `status`,
  `substituteRecipeId`, `notes`
- `slot`: `breakfast` `lunch` `dinner` `snack`
- `status`: `planned` `cooked` `skipped` `substituted`
- `cooked` is terminal — once cooked, the recipe/servings are locked (the
  deduction was computed from them). The UI must make that irreversibility
  legible *before* the click, not after.

**Cook feedback** (one per cooked entry)
- `rating`: `thumbs_up` `thumbs_down`
- `effortCheck`: `felt_right` `too_hard` `too_easy`
- `makeAgain`: `yes` `maybe` `no`
- `usedAsIs`: boolean — if false, a `changesNote` is **required**
- Should feel like a 5-second interaction, not a form.

**Shopping list item**
- `quantityNeeded`, `quantityInPantry`, `netToBuy`, `category`, `bought`, `customNote`
- Group by `category` — that's the aisle order in a shop.

**Profile**
- `name`, `calorieTargetMin/Max`, `macroTargets`, `dietaryRestrictions[]`,
  `cookingSkill` (`beginner` `competent` `advanced`), `kitchenEquipment[]`,
  `householdSize`, `scheduleProfile`, disliked ingredients

**Units**: `mg g kg` (mass) · `ml cl dl l tsp tbsp` (volume) · `piece pcs` (count).
Finnish aliases `tl` `rkl` `kpl` are accepted too. Conversion never crosses
dimensions — you can't turn grams into millilitres, so the UI shouldn't imply
you can.

---

## Screens

### Already backed by a real API — design these for real use

**1. Today** — the landing view. What am I eating today, what's about to go off,
what do I need to do. Should answer "what now?" in one glance.

**2. Pantry** — the list, sorted spoilage-first (soonest expiry at top, not
alphabetical). Filter by location and category. Add/edit/remove. Expiry status is
the dominant visual signal. This screen gets used one-handed at the fridge.

**3. Recipes** — browsable collection, filter by tags and cuisine. Detail view
with ingredients, steps, times, effort score, times-cooked. Include a **servings
scaler** — changing it rescales every ingredient quantity live.

**4. Recipe import** — paste a URL or raw text, AI extracts a draft, I review and
correct it before saving. The review step matters: matched ingredients bind to my
catalog, unmatched lines need me to resolve them by hand. Design that
reconciliation state properly, it's the crux of the screen.

**5. Meal plan** — the week. 7 days × 4 slots. Assign a recipe or a freeform
note, set servings, mark cooked/skipped. Cooking is the big action and it
triggers the pantry deduction.

**6. Cook flow + feedback** — confirm what's being deducted, then the quick
feedback prompt afterwards.

**7. Profile** — targets, restrictions, disliked ingredients, equipment, skill,
household size.

### Not built yet — mock these freely

These are the parts I most want to *see* before I build the backend, so design
them as if they exist. Invent whatever data makes them look right, and feel free
to propose behaviour I haven't specified.

**8. Shopping list** — generated from the week's meal plan minus what's in the
pantry. Grouped by category, check items off as you shop, add ad-hoc items.
Phone-first: this is used walking around a shop, one hand, possibly with gloves
on.

**9. AI meal suggestions** — the intended heart of the app. Suggests meals for
empty slots, weighted toward ingredients about to expire, respecting dietary
restrictions, disliked ingredients, cooking skill, effort tolerance and the
week's schedule. Show *why* each was suggested — "uses 400g chicken expiring
tomorrow" — because an unexplained suggestion is one I won't trust. Let me
accept, reject, or reshuffle.

**10. Nutrition dashboard** — calories and macros against my targets, per day and
across the week. Restrained and numeric; no gamification, no rings, no streaks.

**11. Waste report** — what expired unused, over time. Should feel like feedback
on my planning, not a scolding.

---

## What I want back

A clickable multi-screen mockup — real navigation between the screens, realistic
mock data (Finnish-inflected: rye bread, quark, salmon, lingonberry alongside the
usual), and the empty/loading/error states sketched rather than only the happy
path.

Where you disagree with my structure or think a screen should work differently,
say so and design your version — I'd rather see a strong opinion than a literal
transcription of this brief.
