# AI Integration — Synthesized Plan

## Comparison Summary

### Convergence

All three models agree on the fundamentals:

- **AI as specialized functions, not a chatbot.** The AI is invoked through discrete, purpose-built functions with focused prompts and structured JSON outputs. This is far more reliable than a conversational interface.
- **Structured output (JSON) is mandatory.** Every AI call returns parseable data, not free text. The app never displays raw LLM output to the user without processing.
- **Never trust the AI for arithmetic.** Nutrition math is always validated server-side by summing ingredient data. The AI suggests recipes; the server checks the numbers.
- **Model tiering for cost management.** Use a fast/cheap model for simple tasks (parsing natural language input, normalizing ingredient names) and a more capable model for complex reasoning (meal plan generation, recipe creation).
- **Caching aggressively.** A weekly meal plan doesn't need real-time generation. Cache recipe suggestions when pantry state hasn't changed. Batch requests where possible.

### Divergence

**1. AI architecture: LLM-only vs. hybrid with rules engine**

- Sonnet 4.5: LLM-first for v1, hybrid (rules engine + LLM) for v2. "Move common recommendation patterns to a local rules engine (fast, free) and reserve LLM calls for creative tasks."
- Opus 4.6: LLM-only with structured function calls. No mention of a rules engine.
- Opus 4.5: Hybrid from the start — local LLM for simple tasks, cloud for complex reasoning.

**Recommendation**: LLM-only for v1, with the architecture designed so a rules engine can be added later. The meal plan generation, recipe suggestion, and input parsing all benefit from LLM flexibility. A rules engine makes sense once you've identified which patterns are stable enough to hardcode (Sonnet's v2 insight is correct), but building one prematurely means maintaining two systems before you know which rules matter.

**2. Behavioral learning sophistication**

- Sonnet 4.5: Passive behavioral model — meal completion rate by day, recipe repeat rate, pantry waste rate, cook time accuracy. Feeds the AI's context prompt without a settings UI.
- Opus 4.6: Explicit + implicit signals. Explicit: ratings, dislikes, "more/less like this." Implicit: cooked vs. skipped, substitution patterns, time-to-confirm plans. Stored as key-value preferences.
- Opus 4.5: Three-tier AI (reactive, proactive, adaptive), with adaptation as the most advanced tier deferred to later phases.

**Recommendation**: Align with the phases synthesis — collect all signals from day one (the data structures exist in the data model), but defer the adaptation logic to Phase 4. For v1, the AI's context prompt includes recent history (last 2-3 weeks of meal plan data, ratings, skips) as raw context. The LLM is surprisingly good at picking up patterns from raw data without a formal learning system. Formalized pattern detection comes later when you have enough data to make it worthwhile.

**3. Freshness model: discrete statuses vs. continuous decay**

Already resolved in the data synthesis — discrete statuses (fresh/use_soon/use_today/expired) derived from date math. Opus 4.6's sigmoid freshness curve is theoretically better but adds complexity without changing the practical outcome: the AI still needs to know "use this chicken soon" regardless of whether the score is 0.3 or the status is "use_today."

**4. Proactive vs. reactive AI**

- Sonnet 4.5: AI proactively surfaces suggestions — "Your spinach is getting old, here's a quick sauté."
- Opus 4.6: AI responds to user actions and generates plans on request.
- Opus 4.5: Three tiers — reactive (answer questions), proactive (nudge about expiring food), adaptive (learn and generate).

**Recommendation**: Start reactive (Phase 2 — AI generates plans and recipes when asked). Add lightweight proactive nudges in Phase 3 (expiring item alerts with recipe suggestions). Full adaptive behavior in Phase 4. Proactive AI that gets it wrong is worse than no proactive AI — you need the core loop working well before the app starts volunteering suggestions.

### Unique innovations

**From Opus 4.6 — The specialized function table:**

This is the most concrete and useful AI design artifact across all three plans. Seven discrete functions, each with defined inputs and outputs:

| Function | Input | Output | Phase |
|----------|-------|--------|-------|
| `generateMealPlan` | Goals, pantry state, schedule, preferences, pinned meals, recent history | 7-day meal plan as structured JSON | Phase 2 |
| `suggestRecipesFromPantry` | Pantry items (sorted by urgency), dietary constraints | Ranked recipe list | Phase 2 |
| `parseNaturalInput` | Free text ("bought chicken 1kg, broccoli 2") | Structured pantry items | Phase 1 |
| `importRecipeFromURL` | URL + page content | Structured recipe | Phase 1 |
| `generateRecipe` | Available ingredients, constraints | Full recipe with steps and nutrition | Phase 2 |
| `adaptPlan` | Current plan + change event ("skipped lunch") | Revised remaining-day plan | Phase 3 |
| `weeklyReview` | Week's planned vs. actual data | Insights + next week adjustments | Phase 4 |

**Recommendation**: Adopt this as the AI function architecture. Each function gets its own system prompt and output schema. This is testable, debuggable, and cost-predictable — you know exactly which functions are expensive and which are cheap.

**From Opus 4.6 — The constraint solver framing:**

Rather than asking the AI to "suggest meals," frame meal plan generation as constraint satisfaction with explicit hard constraints (never violate) and soft constraints (optimize for, with weights):

Hard constraints: dietary restrictions, calorie range, allergies.
Soft constraints with weights: use expiring items (high), match day complexity (high), hit macro targets (medium), protein variety (medium), cuisine variety (low), minimize shopping list length (low).

Pinned meals are fixed points the solver works around.

**Recommendation**: Adopt. This framing gives the AI a clear objective rather than vague "make a nice plan." It also makes suggestions explainable: "I suggested this because your chicken expires tomorrow and you have a light day scheduled."

**From Opus 4.6 — Data flow example:**

The "Plan My Week" flow: frontend sends context → backend assembles prompt → Claude returns structured JSON → backend validates nutrition math → backend diffs ingredients against pantry → generates shopping list → frontend shows plan for review.

**Recommendation**: Adopt as the reference implementation for Phase 2.

**From Sonnet 4.5 — Natural language interface (v2+):**

A conversational input bar for quick commands: "I just bought a rotisserie chicken" → adds to pantry and suggests meals. "What can I make with the salmon before it goes bad?" → pantry-first recipe query.

**Recommendation**: Defer to v2+. The discrete function architecture handles all v1 needs. A natural language command bar is a nice UX layer on top but requires intent classification and routing, which is its own complexity.

---

## Synthesized AI Architecture

### Design principles

1. **Specialized functions over general chat.** Each AI capability is a discrete function with a focused system prompt, defined inputs, and a structured JSON output schema.
2. **Server-side validation of everything.** Nutrition math, ingredient matching, and constraint checking happen in application code, not the LLM. The AI suggests; the server verifies.
3. **Context is king.** The quality of AI suggestions is directly proportional to the quality of context in the prompt. Pantry state, recent meal history, user preferences, and schedule data all go into every planning call.
4. **Graceful degradation.** If the AI API is down or slow, the app still works. Pantry tracking, manual recipe browsing, and shopping list generation are all functional without LLM calls. AI is an enhancement, not a dependency.
5. **Cost awareness from day one.** Model tiering, caching, and batching are not optimizations — they're part of the base architecture.

### AI functions by phase

**Phase 1 (Pantry + Recipes):**
- `parseNaturalInput` — Convert free text to structured pantry items. Fast/cheap model. Called on every smart text input.
- `importRecipeFromURL` — Extract structured recipe from a webpage. Capable model (needs to handle messy HTML). Called on each URL import.

**Phase 2 (Planner + Shopping):**
- `generateMealPlan` — The big one. Constraint satisfaction over a 7-day window. Capable model. Called once per plan generation (not per meal). Input includes: pantry state, dietary rules, schedule profile, pinned meals, last 2-3 weeks of history.
- `suggestRecipesFromPantry` — Rank existing recipes by pantry match and urgency. Can be partially done in SQL (ingredient overlap) with AI re-ranking. Called on "what can I make?" queries.
- `generateRecipe` — Invent a recipe from available ingredients + constraints. Capable model. Called when pantry-first search doesn't find good matches.

**Phase 3 (Diet Rules + Refinement):**
- `adaptPlan` — Revise remaining meals when a meal is skipped or substituted. Redistribute nutritional targets. Fast model for simple skips, capable model for complex replanning.

**Phase 4 (Adaptation):**
- `weeklyReview` — Analyze the week's planned vs. actual data, surface insights, suggest adjustments for next week. Capable model. Called once per week.

### Cost management strategy

- **Model tiering**: Use the fastest/cheapest model that can handle the task. Parsing and normalization don't need the same model as meal plan generation.
- **Batch the weekly plan**: One API call for the full 7-day plan, not 21 separate meal calls. The prompt is larger but the overhead of 21 calls is far worse.
- **Cache by pantry state**: If the pantry hasn't meaningfully changed since the last suggestion request, serve cached results. "Meaningfully changed" means an item was added, removed, or crossed a freshness threshold.
- **Precompute locally**: Nutrition summation, ingredient matching, and constraint checking are all done in application code. Don't waste tokens on math.
- **Realistic cost estimate**: For personal use with model tiering and caching, expect roughly $1-5/month in API costs. Weekly plan generation is the most expensive call; everything else is cheap.

### Prompt engineering notes

- Each function gets its own system prompt that establishes role, constraints, and output format. No shared "you are a meal planning assistant" prompt.
- Output schemas should be strict JSON with defined fields. Use examples in the system prompt to demonstrate expected output structure.
- Include a "reasoning" field in plan generation output so the app can show one-line explanations ("uses your bell peppers before Thursday"). The AI's reasoning is a feature, not debug output.
- Pantry data in prompts should be sorted by urgency (expiring items first) so the AI naturally prioritizes them without complex instructions about weighting.

---

## Open Questions for Phase 3

1. **Model selection**: Which specific Claude models for which functions? This depends on current pricing and capability at the time of implementation. The architecture is model-agnostic — any model that accepts a system prompt and returns JSON works.

2. **Recipe generation quality control**: How do you handle AI-generated recipes that are technically valid JSON but culinarily questionable? Human review before saving? A "confidence score"? Accept and let the rating system filter over time?

3. **Prompt versioning**: As you iterate on system prompts, how do you track which version generated which plans/recipes? Important for debugging why the AI suggested something weird.
