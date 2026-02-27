# Development Phases — Synthesized Plan

## Comparison Summary

### The big strategic disagreement: What do you build first?

This is the most consequential divergence across all three models — more important than any feature debate, because it determines what you'll actually be _using_ week by week.

**Sonnet 4.5**: Pantry first → Recipes → Meal planner (with AI) → Shopping list → AI adaptation → Polish. 14+ weeks, 6 phases. Rationale: the pantry is the source of truth, so build the foundation first.

**Opus 4.5**: Manual loop first (inventory + recipes + planning + shopping list) → Smart input → Batch cooking → AI suggestions → Behavioral learning → Full adaptive planning → Nutritional tracking. Most conservative — AI-generated meal plans don't appear until v1.3. Rationale: get a usable manual loop running before adding intelligence.

**Opus 4.6**: Meal planner + nutrition dashboard first → AI + pantry + smart shopping → Adaptation → Polish. 11+ weeks, 4 phases. Most aggressive — AI meal plan generation arrives in Phase 2 (week 4). Rationale: the meal planner is the primary interface, get it working fast.

**The core tension**: Opus 4.5 says "a manual loop without AI is already valuable — don't rush intelligence." Sonnet and Opus 4.6 say "AI generation is the killer feature — get it working early." Meanwhile, they disagree on whether the pantry (Sonnet) or the planner (Opus 4.6) should come first.

### Recommendation

Neither the pure pantry-first nor the pure planner-first approach is right. Here's why:

- **Pantry without recipes or a planner is a glorified expiry tracker.** You can see what's expiring, but so what? You still have to figure out what to cook. Sonnet's Phase 1 milestone ("you can manage your fridge contents and see what's expiring") isn't motivating enough to sustain momentum.
- **A meal planner without a pantry is disconnected from reality.** Opus 4.6's Phase 1 generates meal plans and nutrition dashboards before the pantry even exists — meaning the core promise (suggestions driven by what you actually have) isn't delivered until Phase 2.
- **A fully manual loop without AI is functional but not the vision.** Opus 4.5's approach is the safest but also the slowest to deliver on the app's differentiator. You'd be manually assigning recipes to days for 6+ weeks before AI generation arrives.

**The right order**: Build the _core data layer_ (ingredients, recipes, pantry) as a compressed foundation, then bring the planner _with_ AI generation as the first major milestone. The pantry and planner need each other — neither is valuable in isolation. AI generation is the killer feature and should arrive as early as possible, but it needs pantry data to be smart.

### Other divergences

**1. Nutritional tracking timing**

- Opus 4.6: Phase 1 (day one — nutrition dashboard as home screen).
- Sonnet 4.5: Phase 6 (polish — "optional, non-preachy mode").
- Opus 4.5: Phase 3.x (quality of life).

**Recommendation**: Align with the features synthesis — nutritional tracking is background data collection in v1 (auto-calculated from recipes, stored but not prominently displayed). A visible dashboard is a v2 feature. Opus 4.6 over-prioritized this. The nutrition math should work from the start (ingredient data includes macros), but building progress rings and gap indicators before the core loop is solid is premature.

**2. Recipe import timing**

- Sonnet 4.5: Phase 2 (weeks 4–6).
- Opus 4.6: Phase 2 (weeks 4–6).
- Opus 4.5: Not explicitly phased but implied MVP.

**Recommendation**: Recipe import from URL should be early — it's the fastest way to build a useful recipe collection. Without it, you're manually entering every recipe or relying entirely on AI generation. Move it into the foundation phase.

**3. Shopping list timing**

- Sonnet 4.5: Phase 4 (weeks 9–11) — after the meal planner.
- Opus 4.6: Phase 1 gets basic list, Phase 2 gets smart list.
- Opus 4.5: MVP includes basic shopping list.

**Recommendation**: Basic shopping list (meal plan minus pantry) should come with the planner. It's the natural output of the plan and the primary input path for the pantry (shopping list completion → pantry). Splitting it into a later phase breaks the loop.

**4. When to close the loop**

All three models agree the full loop (plan → shop → cook → pantry update → repeat) is the critical milestone. They disagree on when it happens:

- Sonnet 4.5: Week 11 (Phase 4 milestone).
- Opus 4.6: Week 6 (Phase 2 milestone).
- Opus 4.5: Week 4–6 (MVP, but without AI).

**Recommendation**: The full loop including AI generation should close by the end of Phase 2 — roughly weeks 5–7. This is the moment the app becomes genuinely useful for daily life.

### Unique innovations from the phase plans

**From Opus 4.5:**

- **"Shopping list → inventory completion flow"** as an explicit early feature — not just deferred. This is the #1 pantry input method from our features synthesis. Confirmed as Phase 2.
- **Explicit "Questions This Plan Doesn't Fully Answer"** section. Several of these are real: recipe data sourcing strategy, unit normalization approach, multi-device sync. Carried forward as open questions.

**From Opus 4.6:**

- **Challenge/mitigation table** — practical engineering concerns. Key ones: AI can't do nutrition math (validate server-side), pantry staleness (auto-deduct + gentle reminders), cold start (seed recipes + AI generation + URL import), API cost management (model tiering + caching).
- **"Each phase must be usable on its own"** — good discipline for solo development. Adopted as a principle.

**From Sonnet 4.5:**

- **Explicit "skeleton deploy" in week 1** — get the infrastructure running before building features. Adopted.
- **AI adaptation as its own phase** rather than blended into other phases. Helps contain scope.

---

## Synthesized Phase Plan

### Guiding principles

1. **Each phase is independently usable.** You should be able to stop after any phase and have a working app that provides value.
2. **Close the core loop fast.** Plan → shop → cook → pantry update is the critical cycle. Everything else builds on it.
3. **AI generation is the differentiator.** Get it working as early as possible, but only after the data it needs (pantry, recipes) exists.
4. **Collect learning data from day one.** Even if behavioral adaptation is a later feature, the data structures that capture cooking history, skips, substitutions, and ratings should be in place early.
5. **Don't build UI for features you won't use yet.** Nutritional dashboards, gamification, and advanced preference engines can wait. The data model supports them already.

---

### Phase 0 — Skeleton (Week 1)

**Goal**: Infrastructure running, deployable, nothing interesting yet.

- Project setup (framework, database, ORM, auth)
- Deploy to hosting — a working login and empty shell
- Database schema for all core entities (from data synthesis): Ingredient, Recipe, Pantry Item, Meal Plan Entry, Shopping List, User Profile
- Seed ingredient database (~500 common ingredients from USDA FoodData Central with nutrition data and shelf lives)

**Milestone**: You can log in to a deployed app with a seeded ingredient database. Nothing to _do_ yet, but the foundation is solid.

**Why this matters**: Getting deployment working on day one (Sonnet's insight) avoids a painful "it works on my machine" phase later. Seeding ingredients early means every subsequent feature has real data to work with.

---

### Phase 1 — Pantry + Recipes (Weeks 2–4)

**Goal**: You can track what's in your kitchen and build a recipe collection.

**Pantry:**

- Add/edit/remove pantry items with fuzzy ingredient search
- Smart text input: "chicken 1kg, broccoli 2, milk 1L" → parsed into structured items
- Storage location (fridge/freezer/pantry)
- Auto-calculated expiry dates from ingredient shelf life data
- Opened toggle (recalculates shelf life)
- Urgency view: items sorted by freshness status (fresh → use soon → use today → expired), color-coded

**Recipes:**

- Recipe CRUD (manual creation)
- Recipe import from URL (parser + AI normalization of ingredient names)
- Recipe browsing with filtering (by tag, complexity, cuisine)
- Pantry match indicator: "have 8/10 ingredients" per recipe
- "What can I make?" — filter recipes by current pantry contents, weighted by spoilage urgency

**Milestone**: You can manage your fridge, import recipes from your favorite sites, and see which recipes use your expiring ingredients. This is already more useful than a recipe bookmarking app.

---

### Phase 2 — Meal Planner + Shopping List (Weeks 5–8)

**Goal**: The core loop closes. AI generates your weekly plan, shopping list is derived, cooking updates the pantry.

**Meal Planner:**

- Weekly grid UI (7 days × meal slots)
- Pin specific meals before generation ("tacos on Friday")
- AI-generated week draft — the constraint solver that balances:
  - Dietary restrictions (hard constraints)
  - Pantry urgency (strong preference for expiring items)
  - Day-level complexity/time budgets
  - Variety (protein rotation, cuisine variation)
  - Leftover optimization (cook extra, assign leftovers to future slots)
- Accept / swap individual meals / regenerate
- One-line AI reasoning per meal card ("uses your bell peppers before Thursday")
- Mark meal as cooked → auto-deduct ingredients from pantry (one-tap: "used as-is?" → Yes / "Made changes")
- Mark meal as skipped or substituted
- Post-cook feedback: 3-tap (thumbs up/down, effort check, make again?)

**Shopping List:**

- Auto-generated: meal plan ingredients − pantry stock
- Quantity aggregation (two recipes needing chicken = one combined line)
- Category grouping (produce, dairy, protein, etc.)
- "Always keep stocked" items with restock triggers
- Manual additions ("next time I'm at the store" list)
- Check-off interface while shopping
- **Shopping list completion → pantry**: "Done shopping" adds purchased items to pantry with smart expiry defaults

**Milestone**: The full loop works. You generate a plan, get a shopping list, shop, update your pantry in one tap, cook through the week, and the pantry stays current. **This is the point where the app becomes part of your daily routine.**

---

### Phase 3 — Diet Rules + Refinement (Weeks 9–11)

**Goal**: The planner gets smarter about your actual constraints and preferences.

**Diet profile & rules engine:**

- Rule composer: exclude always, limit (frequency), target (nutritional ranges)
- Named diet presets that populate rules (Mediterranean, keto, high-protein, etc.)
- Weekly rolling average for nutritional targets (not per-day optimization)
- Calorie and macro targets as ranges

**Planner improvements:**

- Busy mode: hard filters on prep time, effort, and ingredient availability for busy days
- Schedule profile: per-day default complexity and time budgets
- Day-level overrides ("Tuesday is busy this week")
- Substitution awareness on shopping lists (don't buy crème fraîche if you have yogurt)
- Inventory confidence: items lose confidence over time, low-confidence items show "check stock" notes

**Recipe engine improvements:**

- Goal-first filtering ("high protein, under 400 cal") as a secondary search mode
- Urgency-driven generation: tap an expiring item → AI generates 2–3 recipes using it
- Recipe forking: modify any recipe → creates your version, original preserved
- Recipe scaling with pantry-aware deduction

**Milestone**: The app plans around your actual diet goals, respects your schedule, and makes smarter shopping suggestions. It handles the reality that Tuesday you're slammed and Sunday you like to cook.

---

### Phase 4 — Adaptation + Learning (Weeks 12–15)

**Goal**: The app learns from your behavior and starts anticipating your patterns.

**Behavioral signals (data already being collected from Phases 1–3):**

- Meals cooked vs. skipped vs. substituted
- Post-cook ratings and effort checks
- Recipe frequency (times cooked)
- Shopping list completion patterns
- Day-of-week cooking patterns

**Adaptation features:**

- Pattern detection: "You skip breakfast most weekdays" → stop planning it, redistribute macros
- "You've marked Wednesday dinner as 'ate out' three weeks running" → suggest not planning it
- Preference learning: surface recipes similar to highly-rated ones, avoid patterns from low-rated ones
- Complexity calibration: if user consistently rates auto-calculated effort as "too hard," adjust scores
- Forward adaptation on skips: redistribute nutritional targets across remaining meals

**Milestone**: The app noticeably improves its suggestions over time. Plans feel personalized rather than generic.

---

### Phase 5 — Polish + Power Features (Weeks 16+)

**Goal**: Quality of life, advanced features, delight.

Prioritize based on what you actually want at this point. Candidates:

- Nutritional dashboard (weekly trends, progress visualization, gap indicators)
- Prep session orchestration (parallel cooking queue for batch prep days)
- Kitchen State mode (cooking-active view with large text, timers, quick logging)
- PWA with offline support (current plan + shopping list available without connection)
- Receipt scanning (camera → OCR → pantry)
- Barcode scanning
- Data export (full JSON/CSV backup — you own your data)
- Shareable shopping lists
- Seasonal eating suggestions
- Cost tracking and budget optimization

---

## Engineering Concerns & Mitigations

These are practical issues that cut across phases, largely drawn from Opus 4.6's challenge table and Opus 4.5's open questions.

| Concern                                                          | Mitigation                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI can't do nutrition math** (LLMs hallucinate numbers)        | Always calculate nutrition server-side by summing ingredient data. The AI suggests recipes; the server validates the math.                                                                                            |
| **Pantry tracking goes stale**                                   | Auto-deduct on cooking is the primary mechanism. Inventory confidence decay adds "check stock" notes. Gentle nudges: "You bought milk 8 days ago — still have some?"                                                  |
| **Cold start: no recipes**                                       | Seed with 50–100 curated recipes for common diets. URL import available from Phase 1. AI generation from Phase 2. The recipe collection grows organically.                                                            |
| **Cold start: no pantry data**                                   | First shopping trip populates the pantry. Before that, the app still works for recipe browsing and manual planning.                                                                                                   |
| **AI API costs**                                                 | Use model tiering: fast/cheap model for parsing and normalization, capable model for meal plan generation. Cache aggressively — a weekly plan doesn't need real-time generation. Batch ingredient parsing.            |
| **Unit normalization** ("1 cup chicken" vs "200g" vs "1 breast") | Standardize internally to metric (grams/ml) with display preferences. AI handles natural language → structured conversion during input. Accept approximate conversions — precision isn't critical for a personal app. |
| **Recipe data sourcing**                                         | Combination approach: curated seed set + URL import + user-created + AI-generated. No need to license a database for personal use.                                                                                    |
| **Scope creep**                                                  | Each phase must be independently usable. If a feature doesn't serve the current phase's milestone, it belongs in a later phase.                                                                                       |

---

## Realistic Timeline Expectations

All three models propose aggressive timelines (11–14 weeks to a polished app). As a solo developer without industry experience, these estimates should be treated as optimistic lower bounds. Some reality checks:

- **Phase 0** (skeleton) is genuinely achievable in a week if the tech stack is chosen and you follow a tutorial/template setup.
- **Phase 1** (pantry + recipes) involves real complexity: ingredient fuzzy matching, URL parsing, spoilage calculations. 3 weeks is reasonable if you resist gold-plating.
- **Phase 2** (planner + shopping + AI) is the hardest phase. AI meal plan generation alone involves prompt engineering, constraint handling, response parsing, and error recovery. The shopping list aggregation math has edge cases. 4 weeks is tight — 5–6 is more realistic.
- **Phase 3** (diet rules + refinements) is mostly UI and business logic on established patterns. 3 weeks is reasonable.
- **Phase 4** (adaptation) depends heavily on how much data you've accumulated by then and how sophisticated the pattern detection needs to be. 3–4 weeks.

**Total realistic estimate**: 15–20 weeks to Phase 4, not 11–14. This is fine. The app is usable from Phase 2 onward, so you're getting value by week 8 at the latest.

---

## Open Questions for Phase 3 (Decision Review)

1. **Lifestyle context modeling** (carried forward): How do WFH days, gym days, seasonal work patterns affect the planner? Day-type templates? Weekly presets? Simple date-level overrides?

2. **Multi-device sync strategy**: For personal use, is the hosting platform's built-in persistence sufficient? Or do you need offline-first with sync?

3. **Recipe seeding approach**: Curate 50–100 recipes manually? Use a public recipe API? Generate a seed set with AI? Some combination?

4. **Backup and data ownership**: When and how to implement full data export? Should this be built early (Phase 1) as insurance, or deferred?

5. **AI model selection**: Which models for which tasks? Parsing/normalization vs. meal plan generation vs. recipe creation have different cost/quality tradeoffs. (This feeds into the tech stack and AI synthesis files.)
