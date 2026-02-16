# Features — Synthesized Plan

## Comparison Summary

### Convergence (all three agree)

These are the bedrock features — every model independently arrived at the same conclusions:

- **Spoilage-first pantry**: Pantry is an urgency queue, not just an inventory list. Items approaching expiry drive meal suggestions.
- **AI-generated weekly meal plan**: The user tweaks a generated plan rather than building one from scratch. This is the core UX loop.
- **Constraint satisfaction planning**: Meal plan generation balances pantry urgency, nutritional targets, complexity budgets, variety, and leftover optimization.
- **Auto-deduct from cooking**: Marking a meal as "cooked" subtracts recipe ingredients from the pantry. This is the biggest time-saver and the reason pantry tracking is worth maintaining.
- **Shopping list as derived artifact**: Generated from meal plan minus pantry stock, with quantity aggregation and category grouping.
- **Recipe import from URL**: Paste a URL, parser extracts structured recipe data, AI normalizes ingredient names against the canonical database.
- **Pantry staples excluded from precise tracking**: Salt, olive oil, basic spices are flagged as "always available" and don't generate shopping list entries or tracking noise.
- **Graceful degradation**: The app must work with imperfect data. Slightly wrong inventory shouldn't break suggestions — it should add "check if you have X" notes.
- **Plan flexibility**: Meal plans are suggestions, not contracts. Easy to swap, skip, substitute. Life happens.

### Divergence (decision points)

**1. Nutritional dashboard as home screen vs. pantry urgency as home screen**

- Opus 4.6 proposes a nutritional cockpit as the home screen (today's plan, weekly rolling average, gap indicators, progress rings).
- Sonnet 4.5 implicitly centers the pantry urgency view — what's expiring drives everything.
- Opus 4.5 doesn't specify a home screen but emphasizes the plan-cook-shop cycle.

**Recommendation**: The pantry urgency view should anchor the experience, with a lightweight nutrition summary visible but not dominant. A full nutritional dashboard is a v2 feature. For a solo developer building a personal app, the daily question is "what should I eat given what I have?" not "am I hitting my macros?" The weekly rolling average concept from Opus 4.6 is worth keeping as a background metric — but not as the primary interface.

**2. Recipe discovery modes**

- Opus 4.6 proposes three explicit modes: pantry-first ("what can I make?"), goal-first ("I need 40g protein under 400 cal"), and vibe-first ("something warm and comforting").
- Sonnet 4.5 focuses on pantry-first with urgency-driven generation.
- Opus 4.5 focuses on pantry-first with AI generation and substitution awareness.

**Recommendation**: Start with pantry-first as the primary mode. Add goal-first as a secondary filter (useful once nutritional tracking is solid). Defer vibe-first — it's the hardest to implement well and the most likely to feel gimmicky. Natural language recipe queries are cool but not essential for v1.

**3. Input methods for pantry items**

- Sonnet 4.5: Manual entry with fuzzy matching, barcode scanning, receipt scanning (AI vision), bulk import from shopping list.
- Opus 4.6: Smart natural language input ("chicken 1kg, broccoli 2, milk 1L"), auto-deduct from cooking, receipt scanning deferred.
- Opus 4.5: Receipt scanning, voice input, quick-add from history, shopping list completion, inferred consumption.

**Recommendation**: Priority order for implementation:
1. **Shopping list completion** → pantry (one tap: "I bought everything on this list") — highest ROI
2. **Smart text input** with natural language parsing ("chicken 1kg, broccoli 2") — Opus 4.6's approach
3. **Auto-deduct from cooking** — marking a meal as cooked subtracts ingredients
4. **Quick-add from purchase history** — "bought these last week, buy again?"
5. Barcode scanning, receipt scanning, and voice input are all deferred — they add significant development complexity for marginal gains when you're the only user.

**4. Complexity modeling**

- Sonnet 4.5: Single 1–5 complexity score.
- Opus 4.6: Multidimensional — `active_time`, `total_time`, `technique_difficulty`, `cleanup_effort`. Argues that a slow cooker meal is 6 hours but 10 minutes of effort.
- Opus 4.5: Auto-calculated from steps, techniques, equipment.

**Recommendation**: Adopt Opus 4.6's multidimensional approach, but simplified. Store `prep_time` (active hands-on), `total_time` (start to eating), and a single `effort_score` (1–5, combining technique difficulty and cleanup). For schedule-based filtering, `prep_time` is what matters on busy days — not total time. A slow cooker meal with 10 min prep is a busy-day winner even though `total_time` is hours.

**5. Bulk prep / meal prep sessions**

- Sonnet 4.5 has detailed bulk prep: a "Prep Session" feature that generates an ordered cooking queue maximizing oven/stove overlap, and outputs "prepared ingredient" items to the pantry with their own shelf lives.
- Opus 4.6 mentions leftover optimization (cook 4 servings, eat 2 Monday) but no explicit prep session feature.
- Opus 4.5 mentions batch prep days in schedule patterns but no detailed feature.

**Recommendation**: Leftover optimization (cook extra, plan leftovers into future meals) is essential and goes in v1. The full "prep session" orchestration (parallel cooking queue, prepared ingredients as pantry items) is a compelling v2 feature but too complex for initial development. For now, tag recipes as `meal-prep-friendly` and plan multiple servings — that gets 80% of the value.

**6. Post-cook feedback**

- Sonnet 4.5: Lightweight 3-tap screen — thumbs up/down, complexity felt right/too hard/too easy, "make again?"
- Opus 4.6: Rating system that feeds preference learning, but less specific about the UX.
- Opus 4.5: Gap between planned and actual is learning data, with a "Used recipe as-is? Yes / Made changes" prompt.

**Recommendation**: Adopt Sonnet's 3-tap approach — it's the most concrete and lowest-friction. The "complexity felt right?" question is especially valuable because auto-calculated complexity scores will often be wrong. The "made changes?" prompt from Opus 4.5 is also worth including to capture substitution patterns.

**7. Diet profile approach**

- Sonnet 4.5: Rule composer (exclude, limit, target, mode) — not a dropdown of named diets.
- Opus 4.6: Target ranges for calories/macros, restrictions, disliked ingredients.
- Opus 4.5: Constraint engine configuration (similar to Sonnet but less detailed).

**Recommendation**: Adopt Sonnet's rule composer concept. It's the most flexible approach and handles everything from strict keto to "just trying to eat more vegetables" without assuming a specific diet philosophy. Named diets become presets that populate rules, not rigid modes.

### Unique innovations worth considering

**From Sonnet 4.5:**
- **Substitution awareness on shopping lists**: If a recipe calls for crème fraîche and you have Greek yogurt, flag the substitution option instead of adding to the list. *Include — directly reduces unnecessary purchases.*
- **"Always keep stocked" items**: Persistent restock triggers for staples the user wants to maintain. *Include — simple to implement, genuinely useful.*
- **Aisle ordering per store**: User teaches the app their store's layout once, list reorders to match. *Defer — nice but unnecessary for one person.*

**From Opus 4.5:**
- **Uncertainty tracking on inventory**: "Definitely have" / "Probably have" / "Not sure" confidence levels per pantry item. *Include as a simplified version — items lose confidence over time if not refreshed. This is more practical than pretending pantry data is always accurate.*
- **"Kitchen State" mode**: Simplified cooking-active view with large text, step-by-step, quick "I used X" buttons, timers. *Defer to v2 — a dedicated cooking mode is valuable but not core to the plan-shop-cook loop.*
- **"Recipe DNA" system**: Analyze recipes into component dimensions (protein source, cooking method, cuisine, effort) for smarter recommendations. *This is essentially good tagging. Include the tagging, defer the recommendation engine.*
- **Progressive precision**: Accept rough estimates early ("some chicken"), optionally increase precision over time, system learns which items you track carefully. *Include as a design principle — don't require precision, accept it when offered.*
- **"Pantry Challenge" gamification**: Zero-waste streaks, "make 5 meals without shopping." *Defer — fun but not essential.*

**From Opus 4.6:**
- **Weekly rolling average over daily targets**: Don't optimize each day independently; a heavier day followed by lighter is fine if the week trends right. *Include — fundamentally better nutritional model and reduces daily anxiety.*
- **Gap indicators with actionable fixes**: "You're 40g protein short today — add a Greek yogurt snack." *Include in v2 when nutritional tracking is solid. Great concept but needs reliable data to not be annoying.*
- **Pin specific meals before auto-fill**: "I definitely want tacos on Friday" → AI plans around them. *Include — simple constraint that makes the planner feel collaborative rather than dictatorial.*
- **Forward adaptation on skips**: If you skip a meal, AI redistributes macros across remaining meals instead of showing red warnings. *Include as a design principle — no guilt, just adaptation.*

---

## Synthesized Feature Specification

### 1. Pantry Manager

The pantry is the app's source of truth. Its state drives everything: what recipes are suggested, what the meal plan looks like, and what goes on the shopping list.

**Core behavior:**
- Every item has a computed freshness status based on `expires_date` vs. today: `fresh` (3+ days), `use_soon` (2–3 days), `use_today` (≤1 day), `expired`.
- The UI sorts by urgency — what needs using first is always visible.
- Color-coded: green → yellow → orange → red.
- Pantry staples (flagged with `is_pantry_staple` in the Ingredient model) are shown in a separate, low-noise section. They're assumed available unless the user explicitly marks them "out of stock."

**Input methods (in priority order):**
1. **Shopping list completion**: Check off your shopping list → items auto-add to pantry with smart expiry defaults based on ingredient type. This is the primary input path.
2. **Smart text input**: Natural language quick-add — "chicken 1kg, broccoli 2, milk 1L" → parsed into structured items with fuzzy ingredient matching.
3. **Auto-deduct from cooking**: Marking a meal plan entry as "cooked" subtracts that recipe's ingredients. One-tap confirmation: "Used recipe as-is?" → Yes / "Made changes" (only then does it ask what changed).
4. **Quick-add from history**: "You bought these items last time" → one-tap re-add for frequent purchases.

**Deferred input methods** (v2+): Barcode scanning, receipt scanning (OCR + AI), voice input.

**Spoilage estimation:**
- Default shelf lives seeded from ingredient database, per storage location (fridge/freezer/pantry).
- `opened` flag recalculates shelf life (opened milk: 5 days, sealed: 14).
- User can always override expiry manually.

**Inventory confidence (simplified):**
- Items automatically lose confidence over time if the pantry hasn't been refreshed. Items added recently or refreshed via shopping list = high confidence. Items lingering without interaction for 2+ weeks = lower confidence.
- Low-confidence items add a soft "check if you have this" note when appearing in recipe suggestions or shopping list calculations, rather than being treated as definitely present or definitely absent.
- This avoids the failure mode of the app confidently saying "you have X" when you used it three days ago without logging.

---

### 2. Meal Planner

The weekly meal plan is the primary planning interface: a 7-column grid (days) × rows (breakfast, lunch, dinner, snack). The plan is generated, not manually built — the user tweaks, not authors.

**Planning flow:**
1. User optionally pins specific meals ("tacos on Friday") or sets day-level overrides ("Tuesday is busy — max 20 min prep").
2. User hits "Generate week."
3. AI produces a full week draft optimized against (in priority order):
   - **Hard constraints**: Dietary restrictions, allergies (never violated)
   - **Pantry urgency**: Recipes that use `use_soon` and `use_today` items are strongly preferred
   - **Schedule fit**: Respect per-day complexity/time budgets from the user profile
   - **Nutritional balance**: Aim for weekly rolling average targets, not daily perfection
   - **Variety**: Don't repeat the same protein source 3 days in a row; vary cuisines and cooking methods
   - **Leftover optimization**: Plan extra servings on cooking days, assign leftovers to subsequent meals to reduce total cooking events
4. User can accept, swap individual meals, lock meals they like and regenerate the rest, or regenerate entirely.

**What the user sees per meal card:**
- Recipe name
- Prep time (active) and total time
- Effort indicator (1–5 dots or similar)
- Pantry match: "uses 3 expiring items" or "need to buy 2 ingredients"
- One-line AI reasoning: "uses your bell peppers before Thursday" or "quick option for your busy Wednesday"

**Meal statuses:** `planned` → `cooked` / `skipped` / `substituted`
- Skipping a meal triggers forward adaptation: the AI redistributes nutritional targets across remaining meals rather than showing warnings.
- Substituting logs what was actually made, capturing the delta for future learning.

**Leftover handling:**
- When a recipe is planned for more servings than one meal, excess servings are automatically assigned to future meal slots as "leftovers of [recipe name]."
- Leftover meals show up in the plan with zero prep time and are auto-deducted from the batch.

**Busy mode:**
- When a day is marked busy (via profile defaults or manual override), the planner applies hard filters: max prep time from profile, low effort score, prioritizes pantry staples and frozen ingredients, surfaces previously well-rated quick meals.

---

### 3. Recipe Engine

Recipes exist on a spectrum from fully user-created to fully AI-generated. The engine handles discovery, import, generation, and feedback.

**Recipe discovery — two modes for v1:**

1. **Pantry-first** ("What can I make?"): Filters recipes by ingredient overlap with current pantry, weighted by freshness urgency. Expiring items boost relevance. Shows a match indicator: "have 8/10 ingredients" or "need to buy: heavy cream, parsley."
2. **Goal-first** ("I need high protein under 400 cal"): Nutritional constraint search. Works as a filter on top of pantry-first or across all recipes.

Deferred: Vibe-first natural language queries ("something warm and comforting") — cool but hard to do well in v1.

**Urgency-driven generation:**
- User taps on an expiring pantry item → AI generates 2–3 recipes that use it prominently, filtered against other available pantry items to maximize fridge-clearing.

**Recipe import:**
- Paste a URL → backend extracts structured data (using recipe-scrapers or similar parser + AI fallback).
- AI normalizes ingredient names against the canonical ingredient database.
- Imported recipes are editable — modifications create a fork (personal version), original preserved.

**AI recipe generation:**
- AI can invent recipes from current pantry contents. These are flagged as "AI-generated."
- User can save, rate, discard, or fork them.

**Recipe scaling:**
- All recipes are fully scalable. Changing serving count recalculates all ingredients.
- Pantry deduction uses actual servings cooked, not base recipe amounts.

**Post-cook feedback (lightweight, 3-tap):**
After marking a meal as "cooked," the user sees:
1. **Rating**: Thumbs up / thumbs down (or optionally 1–5 if they want precision)
2. **Effort check**: Felt right / too hard / too easy
3. **Repeat?**: Make again / maybe / no

Optional: "Used recipe as-is?" → Yes (done) / "Made changes" → brief note on what changed.

This is the primary learning signal. No forced reviews, no lengthy forms. The effort check is particularly valuable because auto-calculated complexity scores will often be wrong in practice.

---

### 4. Shopping List Generator

The shopping list is the integration point where all subsystems converge. If the shopping list is accurate and helpful, everything upstream is working.

**Generation logic (in priority order):**
1. Ingredients needed for the week's meal plan that aren't in the pantry (or are low-confidence in the pantry).
2. "Always keep stocked" items that are running low or flagged as out (user-configured restock triggers for staples like eggs, olive oil, garlic).
3. Manual additions from a persistent "next time I'm at the store" list.

**Exclusions:**
- Pantry staples (unless explicitly flagged as out of stock).
- Optional recipe ingredients that the user doesn't have (surfaced as a separate "nice to have" section, not the main list).

**Smart behaviors:**
- **Quantity aggregation**: Two recipes needing 200g and 300g of chicken = one line item for 500g.
- **Category grouping**: Produce, dairy, protein, grains, frozen, etc. — for efficient store navigation.
- **Substitution awareness**: If a recipe needs crème fraîche and you have Greek yogurt, flag the substitution option instead of adding crème fraîche to the list. Reduces unnecessary purchases.
- **Low-confidence pantry items**: If you "probably have" rice but the app isn't sure, the shopping list shows it with a "check stock" note rather than either blindly skipping it or adding it.

**List statuses:** `draft` → `finalized` → `shopping` → `done`
- Moving to `done` triggers the pantry update flow: "Add purchased items to pantry?"

**Export:** Plain text copy for pasting into a notes app. Direct share via messaging. No fancy integrations needed for a personal app.

---

### 5. Diet Profile & Rules Engine

The diet system is a rule composer, not a dropdown of named diets. This makes it equally useful for strict keto, "trying to eat more vegetables," medical diets, or no specific diet at all.

**Rule types:**
- **Exclude always**: Ingredients or categories to never include (allergens, ethical choices, strong dislikes). Hard constraint — the planner will never violate these.
- **Limit**: Ingredients or categories to minimize. Expressed as frequency: "red meat ≤ 2x/week", "dessert ≤ 3x/week."
- **Target**: Nutritional or food-group goals as ranges. "Protein: 120–160g/day", "Vegetables: 5+ servings/day", "Calories: 1800–2200/day." Ranges, not fixed numbers — gives the planner room and reduces guilt.
- **Mode presets**: Named diet shorthands (Mediterranean, keto, high-protein, etc.) that pre-populate rules. But the user owns the rules, not the label — they can customize anything the preset sets.

**Weekly rolling average**:
Nutritional targets are evaluated as a weekly rolling average, not per-day. The planner can freely schedule a heavier day followed by a lighter one if that makes recipes work better. The dashboard (when built) should emphasize the weekly trend, not daily deviations.

---

### 6. UX Principles

These principles govern design decisions across all features. They represent the strongest convergence across all three models.

1. **Passive input over active logging.** Every interaction that logs data should feel like a byproduct of doing something you'd do anyway (cooking, shopping, planning) — not a separate chore.

2. **Defaults that are right 80% of the time.** The AI generates a full plan; you only touch what you want to change. Friction is proportional to how unusual the request is.

3. **The pantry is always the source of truth.** No suggestion should ignore what's actually in the kitchen. Urgency drives the UI.

4. **Explain, don't just suggest.** Every AI recommendation shows a one-line reason: "uses your bell peppers before Thursday," "quick option for busy Wednesday." This builds trust and makes the system feel collaborative rather than opaque.

5. **Suggest, don't nag.** Notifications about expiring food should feel helpful, not guilt-inducing. "Your spinach is getting old — here's a quick sauté" beats "WARNING: SPINACH EXPIRES TOMORROW."

6. **No guilt, only adaptation.** Skipped a meal? The system redistributes forward. Ate out three Wednesdays in a row? It stops planning Wednesday dinner. The app adapts to what you actually do, not what you said you'd do.

7. **Graceful with imperfect data.** The app should never break because inventory is slightly wrong. Accept rough estimates, provide value with approximate data, and let users increase precision where they choose to.

8. **Opinionated defaults, full override.** The app should work with zero configuration for someone who just wants to eat better. But every assumption should be overridable for specific diets or preferences.

9. **Complexity is earned.** Start with simple views. Advanced features (detailed macros, complex constraint rules, batch cooking optimization) are discoverable but not in-your-face.

---

### 7. Deferred Features (v2+, but data model should not prevent them)

- **Full nutritional dashboard**: Progress rings, weekly trends, gap indicators with actionable fixes. Requires solid nutritional data flowing through the system first.
- **Prep session orchestration**: Ordered cooking queue for batch prep days, maximizing parallel oven/stove usage. Outputs "prepared ingredients" as pantry items with short shelf lives.
- **Kitchen State mode**: Simplified cooking-active view — large text steps, timers, quick "I used X" buttons.
- **Vibe-first recipe discovery**: Natural language intent ("something warm and comforting") — requires good AI integration.
- **Multi-person households**: Shared pantry, split meal preferences, voting on weekly plans.
- **Fitness integration**: Pull activity data from wearables to adjust calorie/macro targets. A manual "I exercised today" toggle may suffice as a simpler alternative.
- **Cost tracking**: Track spend per week, optimize shopping list for price, budget constraints.
- **Seasonal eating mode**: Surface recipes using seasonal produce, integrate with local availability.
- **Pantry Challenge gamification**: Zero-waste streaks, "make 5 meals without shopping" achievements.
- **Store layout learning**: User teaches the app their store's aisle order, shopping list reorders to match.
- **Voice input**: "I just used the last of the eggs" while cooking.
- **Receipt scanning**: Camera → OCR → parse line items into pantry.
- **Barcode scanning**: Camera → product database lookup → pantry add.

---

## Open Questions for Phase 3

1. **Lifestyle context modeling** (carried from data synthesis): How should WFH days, gym days, seasonal work patterns, and variable schedules affect the meal planner's day-level defaults?

2. **Flavor/cuisine preferences**: Should the user explicitly configure spicy tolerance, texture preferences, and cuisine affinities — or let the AI learn from ratings and cooking history? Explicit config is faster to bootstrap but more setup friction.

3. **Recipe complexity auto-calculation**: Can `effort_score` be reliably derived from step count + technique tags + equipment required? Or should it always be user-rated after first cook?

4. **Inventory confidence thresholds**: At what age does a pantry item become "low confidence"? Should this vary by category (produce loses confidence faster than canned goods)?

5. **Substitution engine scope**: How sophisticated should substitution awareness be in v1? Just flagging "you have yogurt instead of crème fraîche" — or actually suggesting ingredient swaps within recipes?
