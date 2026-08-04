# Ruoka frontend — design reference

> **Provenance.** Produced by claude.ai/design from `docs/plans/assets/brief-original.md`
> on 2026-08-04, then reviewed against the live API. Everything below the line is the
> handoff **verbatim** — it is the authoritative spec for *look, layout, copy, states and
> interaction*.
>
> **It is NOT authoritative about the API.** The design tool invented endpoint names it
> had no way to verify. Corrections, verified against the running service:
>
> | Handoff says | Actual |
> |---|---|
> | `POST /api/import/extract` | `POST /api/recipes/import` |
> | `POST /api/plan/:entry/cook` | `POST /api/meal-plans/:id/cook` |
> | `POST /api/feedback` | `POST /api/meal-plans/:id/feedback` |
> | `GET /api/shopping?week=` | `GET /api/shopping-lists/current` |
> | `POST /api/suggest` | does not exist — roadmap #380 |
> | `GET /api/nutrition` | does not exist — roadmap #385 |
> | `GET /api/waste` | does not exist — roadmap #389 |
>
> Two further corrections to its "Domain rules" section:
>
> - **Pantry `status` is returned by the API**, already derived per row by
>   `GET /api/pantry` (`withStatus`, `routes/pantry.ts`). The client must render it, never
>   recompute it — a second implementation would drift on the UTC-day comparison.
> - **Deduction order is FEFO, not FIFO**: soonest `expiresDate`, then *opened before
>   unopened*, then oldest `createdAt` (`sortFefo`, `cook-deduct.ts`). The handoff omits
>   the opened-first tiebreak.
>
> The prototype (`assets/ruoka-prototype.dc.html`) does **not** render in a browser — it is
> a `.dc.html` needing the design tool's template runtime, so `{{ }}` bindings stay literal.
> Read it for its mock-data arrays (`PANTRY`, `RECIPES`, `RAMP`, suggestions, nutrition,
> waste, shopping), which are the intended seed fixtures.
>
> Implementation plan: `docs/plans/2026-08-04-frontend-phase1-plan.md`

---

# Handoff: Ruoka — spoilage-first meal planning frontend

## Overview

Single-user meal-planning web app. The backend exists and is deployed; this handoff covers
the whole frontend: 11 screens plus two modal flows, wired as one clickable mockup.

The product thesis is **spoilage-first planning**. The core loop:

1. Pantry holds what you actually have, each item with an expiry.
2. Recipes are typed in or imported from URLs (AI extraction + manual reconciliation).
3. A weekly plan (7 days × 4 slots) is filled, ideally by AI suggestions weighted toward
   food about to spoil.
4. Missing ingredients become a shopping list (needed − pantry), grouped in aisle order.
5. Cooking an entry auto-deducts ingredients from the pantry, oldest-expiring lot first,
   then asks for 5-second feedback that tunes future suggestions.

Everything in the UI bends toward one question: *what is about to go off, and what do I
cook to use it?*

## About the Design Files

`Diet App.dc.html` in this bundle is a **design reference created in HTML** — a prototype
showing intended look, layout, and behavior. It is not production code to copy.

The target implementation is **vanilla TypeScript + Vite** (stated in the brief: no React,
no Tailwind, no component framework). Recreate the screens in that environment using its
own patterns. The prototype's structure (a state object + a render pass per screen) maps
cleanly to plain TS modules; do not port the prototype's component runtime.

The prototype loads the project's real design system from
`<link rel="stylesheet" href="https://mase.fi/base.css">`. **That stylesheet is the source
of truth for tokens and base components** — use its classes (`.btn`, `.btn-primary`,
`.btn-danger`, `.btn-ghost`, `.btn-sm`, `.input`, `.textarea`, `.label*`, `.status*`,
`.tag*`, `.section-header`, `.form-label`, `.helper`, `.modal*`, `.toast*`, `.loading`,
`.dot*`, `.card-grid`, `.pane`, `.scroll-region`, `.bar-sticky`, flex/gap utilities) rather
than reimplementing them. Inline styles in the prototype exist only because of its
authoring constraints — in the real app, move anything reusable into project CSS that sits
on top of base.css.

## Fidelity

**High fidelity.** Final colors, type scale, spacing, density, copy, and interaction
behavior. Every value below comes from base.css tokens or is listed explicitly. Recreate
faithfully; where the prototype uses an inline style that duplicates a base.css class,
prefer the class.

One deliberate deviation from the brief, already applied: **`--accent` is overridden from
amber `#e8a308` to cyan `#06b6d4`** (`--accent-text: #22d3ee`). Reason: amber collides with
the expiry ramp, which is the app's primary color language. Chrome is cyan; amber/orange/red
belong to spoilage only. If the team rejects this, revert the two custom-property
declarations — nothing else depends on it.

## Design Tokens

All from `https://mase.fi/base.css` unless noted.

### Surfaces
| Token | Value | Use |
|---|---|---|
| `--bg` | `#09090b` | app background, sidebar, list backgrounds |
| `--bg-surface` | `#131316` | panels, screen header bar |
| `--bg-raised` | `#18181c` | group headers, inline controls, chips |
| `--bg-hover` | `#27272a` | hover, active nav, skeleton bars, empty meter track |
| `--bg-overlay` | `#1f1f24` | modal body |
| `--bg-overlay-rim` | `#26262c` | modal header/footer |
| page backdrop | `#050506` (literal) | area outside the app frame in phone mode |

### Borders
`--border #27272a` · `--border-hover #3f3f46` · `--border-overlay #3f3f46` (modal perimeter)

### Text
`--fg-1 #fafafa` primary · `--fg-2 #a1a1aa` dim · `--fg-3 #52525b` muted
(aliases `--text`, `--text-dim`, `--text-muted`)

### Accent (project override)
```css
:root { --accent: #06b6d4; --accent-text: #22d3ee; }
```
`--accent-glow` = `color-mix(in srgb, var(--accent) 12%, transparent)` — tracks the override.

### Semantic
`--green #22c55e` · `--red #ef4444` · `--orange #d29922` · `--blue #58a6ff` ·
`--cyan #06b6d4` · `--purple #bc8cff`, each with `--*-bg` at a 15% tint.

### The expiry ramp — the app's most important color decision
Derived from a pantry item's `expiresDate`; drives status pills, row tints, and a 3px left
edge bar on every pantry-ish row.

| status | condition | color | tint (badge) | row background |
|---|---|---|---|---|
| `expired` | days < 0 | `--red` | `red 15%` | `red 6%` |
| `use_today` | ≤ 1 day | `--orange` | `orange 15%` | `orange 5%` |
| `use_soon` | ≤ 3 days | `#e8a308` (amber, literal) | `#e8a308 14%` | none |
| `fresh` | > 3 days | `--green` | `green 12%` | none |

Amber is used here as a *literal*, not via `--accent`, precisely so a re-theme of the accent
cannot disturb the ramp. Keep that separation.

Days-remaining label formatting: `-1` → `"1d ago"`, `0` → `"today"`, `1` → `"1 day"`,
`< 60` → `"N days"`, else `"N mo"` (rounded /30).

### Typography
`--font: 'JetBrains Mono', 'Consolas', monospace` for everything. Weights 400/500 (Regular
file) and 600/700 (Bold file) — no other weights, no synthesis.

Sizes: `--text-xs 10px` · `--text-sm 11px` · `--text-base 12px` (body default) ·
`--text-md 13px` · `--text-lg 15px`. Line height `--leading 1.4`, `--leading-tight 1.2`.

Conventions used throughout: uppercase + `letter-spacing:.04em` at `--text-xs` for
section headers and field labels (`.section-header`, `.form-label`); `--text-md` for
primary row titles; `--text-xs`/`--text-sm` muted for metadata lines; `--text-lg` + 700 for
stat numbers. `text-wrap: pretty` on any prose paragraph.

### Spacing
`--space-1 2px` · `-2 4px` · `-3 8px` · `-4 12px` · `-5 16px` · `-6 24px`.
In practice: screen padding `10px`, panel padding `8px`, row padding `6px 8px`–`7px 10px`,
grid/flex `gap` of `1px` (hairline dividers via a `--border` background behind grid cells),
`5–6px` (control clusters), `8–10px` (panels).

### Radius, elevation, motion
`--radius: 0` — **square everywhere, no exceptions**. No `box-shadow` anywhere: elevation is
structural (two surface steps + `--border-overlay` rim + `rgba(0,0,0,.6)` backdrop).
`--transition: .15s ease`, applied to `background` and `border-color` only.
Keyframes used: `shimmer` (skeletons, `1.4s ease-in-out infinite`, opacity `.35 → .7`),
plus base.css's `spin`, `pulse`, `toast-in`.

Control heights: buttons `22px` (`--btn-h`), `.btn-sm` `18px`, inputs `22px`. **Overridden
upward for touch:** any control on a phone-first surface gets `26–34px`, and tap rows get
`min-height: 46–54px` (see Responsive).

## Layout Architecture

### App shell
```
┌───────────────────────────────────────────────────────────┐
│ chrome bar  (prototype only — see note)            34px   │
├──────────┬────────────────────────────────────────────────┤
│ sidebar  │ screen header bar                        30px  │
│ 158px    ├────────────────────────────────────────────────┤
│          │ scroll region (flex:1, overflow-y:auto)        │
│          │                                                │
└──────────┴────────────────────────────────────────────────┘
```
- Root: `height:100dvh; display:flex; flex-direction:column; overflow:hidden` (base.css
  `.app-shell` is the equivalent).
- The scroll contract from base.css applies: one scroll region per pane, `flex:1 1 0` +
  `min-height:0` **only inside a parent with definite height**. (A `flex:1 1 0` child inside
  a modal whose height came only from `max-height` collapses to 0 — use `flex:1 1 auto;
  min-height:0` there. This bit us in the prototype; don't repeat it.)
- **Chrome bar is prototype scaffolding**, not product: it holds the desktop/phone viewport
  toggle. Drop it in the real app.

### Sidebar (desktop)
158px, `border-right: 1px solid var(--border)`, background `--bg`. Two groups under
`.section-header` labels — **plan** (Today, Pantry, Meal plan, Suggestions, Shopping) and
**review** (Recipes, Import, Nutrition, Waste, Profile). Each item:
`display:flex; gap:7px; padding:5px 9px; font-size:var(--text-base)`, a 14px centered glyph
column, a flexible label, and an optional count badge (`.label` with a semantic tint —
red for expired-pantry, cyan for suggestions, orange for unbought shopping items).
Active item: `background: var(--bg-hover)`, `color: var(--fg-1)`,
`border-left: 2px solid var(--accent)`, glyph in `--accent-text`. Inactive:
transparent background, `--fg-2` label, `--fg-3` glyph.
Sidebar footer, `--text-xs` muted, `border-top`: `"pantry 15 items · 1 expired"` /
`"api ok · synced 12:41"`.

Glyphs are geometric unicode, not icons: Today `◆`, Pantry `▤`, Meal plan `▦`,
Suggestions `✳`, Shopping `▣`, Recipes `▧`, Import `↓`, Nutrition `▪`, Waste `▫`,
Profile `◍`, More `⋯`. If the codebase has a line-icon set, swap to base.css's `.icon`
contract (currentColor stroke, `stroke-width 1.5`, round caps, 14px default).

### Screen header bar
`padding:7px 10px`, `background: var(--bg-surface)`, `border-bottom: 1px solid var(--border)`.
Left: screen title (`--text-md`, 700) + muted `--text-sm` subtitle. Right:
`<span class="status status-running">api</span>` and a muted `--text-xs` date.
Per-screen title/subtitle pairs:

| screen | title | subtitle |
|---|---|---|
| today | Today | tiistai 4.8. · 3 planned, 1 cooked |
| pantry | Pantry | 15 items · spoilage order |
| recipes | Recipes | 7 in collection · filter by tag |
| import | Recipe import | url or text → draft → review |
| plan | Meal plan | vk 32 · 7 days × 4 slots |
| suggest | AI suggestions | spoilage-weighted, explained |
| shopping | Shopping list | aisle order · needed minus pantry |
| nutrition | Nutrition | vs 2100–2500 kcal |
| waste | Waste | what expired unused |
| profile | Profile | targets, restrictions, kit |
| more | More | everything else |

## Responsive Behavior

Per the brief, screens are optimized for their actual place of use rather than uniformly.

**Phone (390×844, Android Firefox target) — phone-first surfaces:** Shopping list, Pantry,
Cook flow, Today.
- Sidebar is replaced by a **bottom tab bar**: 5 tabs — Today `◆`, Pantry `▤`, Shop `▣`,
  Plan `▦`, More `⋯`. Each tab `flex:1; min-height:54px; padding:8px 2px 9px`, glyph 15px
  over an `--text-xs` label, active tab `color: var(--accent-text)` +
  `border-top: 2px solid var(--accent)`. The **More** screen is a 52px-row list linking the
  six non-tab screens, each with a live subtitle ("2 lines need resolving", "310 g last week").
- Tap targets: pantry rows `min-height:46px`; shopping rows `min-height:54px` with a
  26×26px checkbox square; inline inputs/buttons grow to 28–34px. No action depends on hover.
- Two-column layouts collapse to one (`grid-template-columns: 1fr`): recipe list+detail,
  import review, ingredients/steps, profile.

**Desktop-first surfaces:** Meal plan week grid, Recipe import review, Profile, Nutrition —
dense, multi-column. The week grid keeps `min-width:1050px` inside `overflow-x:auto` on
narrow viewports rather than restructuring; the nutrition table does the same at `560px`.

**Card grids** use base.css `.card-grid` with `--card-min` (suggestions: `320px`). Do **not**
hand-roll `repeat(auto-fill, minmax(280px, 1fr))` — a bare minmax floor is a hard minimum
and overflows narrow viewports. Same reason, stat strips use
`repeat(auto-fit, minmax(min(<N>px, 100%), 1fr))`.

## Screens / Views

### 1. Today — landing view
**Purpose:** answer "what now?" in one glance. It is a queue of actions, not a dashboard.

**Layout:** `padding:10px; display:flex; flex-direction:column; gap:10px`.
1. **Stat strip** — `repeat(auto-fit, minmax(min(110px,100%),1fr))`, `gap:1px` over a
   `--border` background inside a 1px border (hairline cells). Each cell `padding:7px 9px`:
   uppercase `--text-xs` muted key, `--text-lg`/700 value, `--text-xs` muted note.
   Values: `eaten 1 480` (orange) "of 2 100–2 500 kcal" · `protein 84 g` "target 130 g" ·
   `use today 2` (orange) "salmon 400 g · rahka" · `expired 1` (red) "dill · 1d ago" ·
   `to buy 11` (accent) "before saturday".
2. **Two panels side by side** — `repeat(auto-fit, minmax(min(300px,100%),1fr)); gap:10px`.
   - **today · tiistai 4.8.** — one row per slot (`min-height:42px`): 58px uppercase
     `--text-xs` slot name, title + `--text-xs` muted meta, status `.label`, and a trailing
     action button. Rows: breakfast *Rahka & puolukka bowl* cooked → button `locked`
     (`opacity:.5`, toasts the terminality rule); lunch *Ruisleipä & graavilohi* cooked →
     `rate` (opens feedback modal); dinner *Lohikeitto* planned, meta "4 servings · uses
     salmon expiring today" → primary-styled `cook →` (opens cook modal); snack *empty*
     (`--fg-3`) → `fill` (navigates to suggestions).
   - **spoiling** — top 5 pantry items in expiry order, each with the 3px ramp edge bar,
     name + Finnish alias in muted, `qty · location`, and a ramp-tinted `.label`.
     Footer buttons: `plan around these` (primary → suggestions), `waste report`.
3. **what now** — full-width panel of 40px action rows, each a glyph in a semantic color,
   the sentence, and a trailing `→`:
   "Cook tonight's lohikeitto — clears 400 g salmon + the dill" (accent `◆`) ·
   "2 imported recipe lines still unmatched" (red `↓`) ·
   "Sunday is empty — 4 slots, 6 suggestions waiting" (orange `✳`) ·
   "Shop before saturday · 13 items in 5 aisles" (`▣`).

### 2. Pantry
**Purpose:** one-handed use at the fridge. Sorted **spoilage-first, never alphabetical**.

**Layout:** sticky filter bar (`.bar-sticky`, background `--bg`, `padding:7px 10px`,
`gap:6px` column) over a flat list.
- **Location chips:** all / fridge / freezer / pantry / counter, each `.btn-sm` at
  `height:26px; padding:0 9px` with a muted count. Active: `--bg-hover` background,
  `--border-hover` border, `--fg-1` text. Category filter belongs here too (base.css
  `<base-select>`).
- **Search input** `height:28px`, placeholder `"search 462 ingredients — peruna, potato…"`
  (must match Finnish aliases), plus a primary `+ add`.
- `.section-header`: "sorted by expiry · soonest first".
- **Rows** (`min-height:46px`, `border-bottom: 1px solid var(--border)`, background = ramp
  row tint): 3px full-height ramp edge bar; then `padding:6px 10px` flex — name at
  `--text-md` + Finnish alias at `--text-sm` muted + optional `opened` `.label-muted`;
  second line `--text-xs` muted `category · location · added D.M.`; right-aligned quantity
  at `--text-md` over a ramp-colored `--text-xs` status line ("use soon · 2 days",
  "expired 1d ago"); trailing 30×30 `⋯` overflow button.

**Mock data (15 items, in sort order)** — name / alias / qty / category / location / days to expiry:
Dill·tilli 20 g produce fridge −1 · Salmon fillet·lohifile 400 g protein fridge 0 ·
Quark·rahka 500 g dairy fridge 1 (opened) · Milk·maito 1 l dairy fridge 2 (opened) ·
Spinach·pinaatti 200 g produce fridge 2 · Chicken thigh·broilerin reisi 600 g protein
fridge 3 · Rye bread·ruisleipä 6 pcs grain counter 4 · Sour cream·smetana 200 ml dairy
fridge 5 · Carrot·porkkana 700 g produce fridge 12 · Oltermanni cheese·juusto 400 g dairy
fridge 14 · Potato·peruna 2 kg produce pantry 21 · Butter·voi 250 g dairy fridge 30
(opened) · Onion·sipuli 1 kg produce pantry 34 · Pearl barley·ohrasuurimo 900 g grain
pantry 210 · Lingonberry·puolukka 300 g produce freezer 240.

### 3. Recipes
**Purpose:** browse the collection; read one while cooking; scale servings.

**Layout:** `grid-template-columns: 270px 1fr; gap:10px; padding:10px; align-items:start`
(one column on phone).
- **List panel:** tag filter row (`all quick fish vegetarian oven no-cook` as `.btn-sm`),
  then rows: title at `--text-md` + right-aligned `--text-xs` total time; second line
  `--text-xs` muted `cuisine · effort N/5 · cooked N× · ★N`. Selected row:
  `--bg-hover`, `border-left:2px solid var(--accent)`.
- **Detail panel:**
  - Header: `<h1>` title + source-type `.label` tinted by kind — manual `--bg-raised/--fg-2`,
    imported `--blue-bg/--blue`, ai `--purple-bg/--purple`, forked `--cyan-bg/--cyan`.
    Subline `--text-sm` muted: `cuisine · tag · tag · base recipe N servings`.
  - Stat strip (hairline, `minmax(min(84px,100%),1fr)`): prep, total, effort (green ≤3,
    orange >3), cooked, rating (accent).
  - **Servings scaler**, `background: var(--bg-raised)`, `padding:7px 10px`: uppercase
    `--text-xs` label, `−` / value / `+` (30×26 buttons, value `--text-lg`/700 in
    `--accent-text`, clamp 1–12), and a muted note — `"base recipe"` when unchanged, else
    `"scaled ×1.5 from 4"`.
  - **Ingredients | steps**, 1fr 1fr, divided by `border-right`. Ingredient line:
    74px right-aligned quantity in `--accent-text`, name, `--text-xs` muted note, optional
    `optional` `.label-muted`, and a pantry-availability `.label` — `in pantry` (green
    tint), `expired` (red tint), `to buy` (`--bg-raised`/`--fg-3`). **Quantities rescale
    live** with the scaler: `qty × servings / baseServings`, formatted as round-to-5 above
    100, one decimal below, comma decimal separator (Finnish).
  - Steps: numbered `1.` in muted, prose with `text-wrap:pretty`.
  - Footer actions: `add to plan` (primary), `cook now`, `fork` (ghost), `edit` (ghost).

**Mock recipes (7):** Lohikeitto (manual, 15/35 min, 4 serv, effort 2, ★5, cooked 11×) ·
Karjalanpaisti (manual, 20/190, 6, 2, ★5, 3×) · Rahka & puolukka bowl (manual, 5/5, 1, 1,
★4, 24×) · Ruisleipä & graavilohi (manual, 6/6, 2, 1, ★5, 9×) · Ohrarisotto metsäsienillä
(imported, 15/40, 4, 3, ★4, 2×) · Pinaattiletut (manual, 10/25, 3, 2, ★4, 5×) ·
Uunilohi & juurekset (ai, 10/45, 4, 1, ★4, 1×). Full ingredient lines and steps are in the
prototype's logic (`RECIPES`) — reuse them as seed/fixture data.

### 4. Recipe import — three explicit states
**Purpose:** URL or raw text → AI draft → **human reconciliation** before anything is saved.
The reconciliation step is the crux of the screen.

State tabs in the prototype (`1 · paste`, `2 · extracting`, `3 · review`) are a mockup
affordance; in the real app these are sequential stages.

- **paste:** panel `max-width:620px` — `source url` input (example
  `https://www.k-ruoka.fi/reseptit/ohrarisotto-metsasienilla`), `or paste raw text`
  textarea (`min-height:110px`), primary `extract draft`, and the reassurance line
  *"nothing is saved until you approve the review step"*.
- **extracting:** `.loading` row — *"extracting · matching lines against 462 catalog
  ingredients"* — over 5 shimmer bars (`height:12px`, widths 72/54/88/41/66%,
  `background: var(--bg-hover)`, `shimmer 1.4s`), plus a ghost `cancel`.
- **review:** `grid-template-columns: 1fr 1.15fr; gap:10px`.
  - **Left — draft fields:** title, prep/total/servings (3-up), cuisine/effort (2-up),
    steps textarea (`min-height:96px`, "5 extracted").
  - **Right — ingredient reconciliation.** Header: `.section-header` +
    `<span class="label label-green">9 bound</span>` `<span class="label label-red">2 need
    you</span>`. Each line is a row with a 3px state edge bar, `padding:6px 8px`: index
    `1.` muted, the **raw extracted text** at `--text-md`, a state `.label`; then an
    indented (22px) binding line — `→` + target + a `.label-muted` quantity.

    **Three states, not two** — this is a deliberate improvement over the brief:
    | state | color | meaning |
    |---|---|---|
    | `bound` | green | matched a catalog ingredient with an explicit quantity |
    | `assumed` | amber `#e8a308` | matched, but a value was inferred ("1 iso sipuli" → 150 g assumed) |
    | `unresolved` | red (+ `red 5%` row tint) | no match, or missing quantity — blocks saving |

    Assumed lines are the ones that quietly poison a catalog, so they get their own signal
    while still allowing save.

    **Unresolved lines expand** into a `--bg-raised` box with a red-tinted border:
    *"closest catalog matches — pick one, or add it"*, candidate `.btn-sm`s with fuzzy
    scores (`Mushroom, button 0.61`, `Chanterelle 0.58`, `Porcini, dried 0.44`), then
    `create "Forest mushrooms"` (primary) and `skip line` (ghost).
  - Footer: **disabled** primary `save recipe` + `.helper-error` *"2 unresolved lines block
    saving — resolve or skip them"*.

  Seed lines: `3 dl ohrasuurimoita` → Pearl barley (bound) · `250 g metsäsieniä` →
  unmatched (unresolved) · `1 iso sipuli` → Onion, 150 g assumed · `40 g voita` → Butter
  (bound) · `9 dl kasvislientä` → Vegetable stock (bound) · `reilusti raastettua
  Oltermannia` → quantity missing (unresolved; candidates are quantities: 80 g typical /
  120 g generous / bind only) · `tilliä` → Dill, 10 g optional (assumed).

### 5. Meal plan — the week
**Purpose:** fill 7 days × 4 slots; cooking is the big action.

**Layout:** toolbar (`← vk 32 · 3.–9.8. →`, muted "18 of 28 slots filled · 4 cooked",
right-aligned primary `fill with AI` + `shopping list →`), then a grid:
`repeat(7, minmax(150px,1fr)); min-width:1050px; gap:1px` on a `--border` background inside
`overflow-x:auto` + 1px border.

Each **day column**: header (`--bg-raised`, `padding:5px 7px`) with weekday (`ma ti ke to pe
la su`, 700; today in `--accent-text`), right-aligned `--text-xs` date, and a `--text-xs`
kcal line (orange when under target, `--fg-3` when unplanned). Then 4 **slot cells**
(`min-height:66px; padding:6px 7px; text-align:left`, `border-left:2px` in the status
color): uppercase `--text-xs` slot name, `--text-sm` title (`text-wrap:pretty`), then a
status `.label` + muted `N serv`.

Status treatment, and what a click does:
| status | label tint | cell | click |
|---|---|---|---|
| `planned` | `--bg-raised`/`--fg-2` | normal | opens the **cook confirm modal** |
| `cooked` | `--green-bg`/`--green` | `green 5%` background, title dimmed to `--fg-2` | toasts *"Cooked entries are locked — the deduction was computed from them."* |
| `skipped` | `--red-bg`/`--red` | normal | (re-open entry) |
| `substituted` | `--orange-bg`/`--orange` | normal | (re-open entry) |
| empty | `+ fill` in `--fg-3`, no edge | transparent | navigates to **AI suggestions** |

Legend row below, `--text-xs` muted, restates: planned → click to cook; cooked → locked,
deduction applied; substituted; skipped.

Seed week (vk 32): monday breakfast Rahka cooked / lunch "Työlounas — canteen" (freeform
note, planned) / dinner Karjalanpaisti cooked 6 · tuesday = today, dinner Lohikeitto planned
4 · wednesday all planned incl. "Karjalanpaisti · leftovers" · thursday dinner **skipped** ·
friday dinner **substituted**, snack "Rye bread & cheese" · saturday partly planned ·
sunday entirely empty.

### 6. Cook flow + feedback (two modals)
**Purpose:** make the pantry deduction legible and its irreversibility legible **before**
the click; then collect feedback in ~5 seconds.

**Cook confirm modal** — `width:520px; max-width:94vw; max-height:90dvh`,
`background: var(--bg-overlay)`, `border: 1px solid var(--border-overlay)`, column flex,
over a `rgba(0,0,0,.6)` backdrop (`.modal-backdrop`).
- Header (`--bg-overlay-rim`): `"Cook · Lohikeitto"` 700 `--text-md`, right side muted
  `"ti 4.8. · dinner · 4 servings"`.
- Body — **`flex:1 1 auto; min-height:0; overflow-y:auto`** (not `flex:1 1 0`; the modal has
  no definite height, so a 0 basis collapses the body — verified bug):
  - `.section-header` *"will be deducted · oldest expiry first"*.
  - One row per ingredient: name + `--text-xs` muted **lot provenance**
    (`lot 2.8. · expires today`, `lot 26.7. · EXPIRED 1d`, `not in pantry — buy first`),
    then a 70px right-aligned `−400 g` in `--red`, then a 78px muted `0 g left`.
    Naming the lot is the point: it shows *which* stock the FIFO deduction consumes.
  - **Irreversibility warning**, `background: var(--orange-bg)`, `color: var(--orange)`,
    leading `!`: *"Marking cooked is final. The deduction above is computed from **4
    servings** and the entry locks — to change servings or recipe, do it now."*
  - **Servings stepper inside the modal** (`−` 4 `+`), muted note "quantities above rescale
    live" — the deduction table recomputes as you change it.
- Footer (`--bg-overlay-rim`, right-aligned): ghost `cancel`, `mark skipped`, primary
  `deduct & mark cooked`.

**Feedback modal** — `width:420px`. Header: *"Cooked. 8 items deducted."* + ghost `skip`
(explicitly optional). Body: four label + chip-row groups, chips `height:32px`, selected
chip = `--accent-glow` background, `--accent-text`, `accent 45%` border:
- `worth it?` → `▲ yes` / `▼ no` (`rating: thumbs_up | thumbs_down`)
- `effort felt` → `right` / `too hard` / `too easy` (`effortCheck`)
- `make again` → `yes` / `maybe` / `no` (`makeAgain`)
- `cooked as written` → `as-is` / `changed it` (`usedAsIs`)

Choosing **changed it** reveals a required field: label *"what did you change?"* + red
`required`, textarea `aria-invalid="true"`, placeholder "halved the cream, added dill at the
end", and `.helper-error` *"changesNote is required when you didn't cook it as written"*.
Footer: primary `save · tunes suggestions`. Validation rule: `usedAsIs === false` ⇒
`changesNote` non-empty.

### 7. Profile
**Layout:** `1fr 1fr; gap:10px` (one column on phone).
- **targets panel:** name `Mase`; kcal min `2100` / max `2500`; protein `130` / carbs `230`
  / fat `80`; household `2`; skill `competent`; **schedule profile** free text
  *"late shift tue+thu · long weekend cooking"* with `.helper` explaining how suggestions
  consume it: *"low-effort on late-shift days, effort ≤ 2 on weeknights."*
- **chip panels** (each with a `.section-header` + a muted `--text-xs` note that states the
  filter semantics):
  - `dietary restrictions` — note *"hard filter"* — `no shellfish` (red tint),
    `low lactose` (orange tint), each with a `×`.
  - `disliked ingredients` — note *"soft — down-weighted, never blocked"* — coriander,
    liver, blue cheese, olives.
  - `kitchen equipment` — note *"gates suggestions"* — oven, hob 4, cast iron, blender,
    no sous-vide, no air fryer.
  - Each panel ends with a ghost `+ add`.

### 8. Shopping list (not yet backed by API — designed freely)
**Purpose:** used walking around a shop, one hand, possibly gloved. Phone-first.

**Layout:** sticky header + category groups + ad-hoc add.
- **Sticky header:** `"7 / 13 bought"` at `--text-md`/700, a 4px progress meter
  (`--bg-hover` track, `--accent` fill), a `reset` button, and a muted `--text-xs`
  provenance line *"from vk 32 plan · minus pantry · aisle order"*.
- **Group header** per category (`--bg-raised`, border top+bottom): `.section-header` in the
  category's color + right-aligned muted `bought/total`. Aisle order = category order:
  **produce** (green) → **protein** (red) → **dairy** (blue) → **grain** (orange) →
  **condiment** (purple) → spice → other.
- **Item rows** — `min-height:54px; padding:9px 10px; gap:10px`, whole row is the tap
  target: 26×26 checkbox square (unchecked `--border-hover` border, transparent; checked
  `--green` border, `--green-bg` fill, `✓` in green), name at `--text-md`, `--text-xs` muted
  provenance ("lohikeitto ti", "pinaattiletut ×2", "ad-hoc"), right-aligned `netToBuy` in
  `--accent-text` over a muted pantry line. Checked row: `green 5%` background, name
  `line-through` + `--fg-3`, quantity de-emphasised to `--fg-3`.
- The pantry line carries the arithmetic honestly: `have 0`, `have 200 g — half short`,
  `have 1 l — 4 dl short`, `have 6 pcs — enough`, `optional`.
- Footer: `add something else…` input (34px) + primary `add`.

Seed items (13): produce — Leek 2 pcs, Mushrooms forest 250 g, Spinach 200 g, Lemon 1 pcs
(optional); protein — Pork shoulder 700 g, Beef chuck 500 g, Cured salmon 120 g; dairy —
Cream 2 dl, Milk 6 dl, Egg 4 pcs; grain — Rye bread 4 pcs, Wheat flour 360 g; condiment —
Fish stock 1 l, Honey 1 jar (ad-hoc).

**Empty state** (`max-width:420px`, `padding:24px 14px`): heading *"Nothing to buy"* at
`--text-lg`/700, dim prose *"The week's plan needs nothing the pantry doesn't already have.
Either you planned well, or the week is empty."*, buttons `open the week` (primary) +
`show a real list`.

### 9. AI meal suggestions (not yet backed by API)
**Purpose:** the heart of the app. Every suggestion must explain itself.

**Layout:** a state row (mockup only), a weighting summary strip, then
`.card-grid` with `--card-min: 320px`.
- **Weighting strip** (`--bg-raised`, `padding:7px 9px`, `--text-sm`):
  *"weighting **spoilage 0.5** · restrictions **hard** · effort ≤ **3**"* and muted
  *"10 empty slots · 6 suggestions that clear the fridge first"*. These are the knobs; make
  them editable when the backend lands.
- **Card:** header row with uppercase `--text-xs` target slot (`ti · snack`) and a score
  `.label`; spoilage-driven cards get `scoreKind: hot` → orange tint + an
  `orange 45%` card border, so "this clears the fridge" is visible before reading.
  Body: title `--text-md`/700, muted `--text-xs` meta (`5 min · effort 1/5 · 320 kcal ·
  cooked 24×`), then **why lines** at `--text-sm`, one per reason:
  | kind | glyph | color | use |
  |---|---|---|---|
  | spoilage | `!` | `--orange` (text too) | "Uses 250 g quark that expires tomorrow" |
  | neutral | `·` | accent glyph, `--fg-2` text | fit/context reasons |
  | blocker | `×` | red glyph, `--fg-2` text | costs and caveats |
  Footer: primary `accept → ti · snack` (flex:1, 28px), `shuffle`, ghost `no`.
- **Blockers are shown, not hidden** — a second deliberate improvement: cards state their
  costs ("Needs 1.2 kg meat you don't have — adds 2 shopping lines", "Rejected twice
  recently — will stop offering it"). An unexplained *or* uncosted suggestion doesn't get
  trusted.
- Accepting toasts *"Added to ti · snack — plan updated, shopping list recalculated."*

Six seed suggestions with full reason lists are in the prototype's `suggestions` array.

**Loading state:** `.loading` — *"scoring 84 recipes against 15 pantry items · 10 empty
slots"* — over 5 shimmer bars.
**Error state:** `max-width:520px`, `--red-bg` background, `red 40%` border: heading
*"suggestion service unreachable"*, dim prose *"502 from the model gateway after 3 retries.
Your plan and pantry are untouched — nothing was written."*, a `<pre>` with
`POST /api/suggest → 502 bad_gateway` / `request 8f1c·b204 · 12:41:07`, then `retry`
(primary) + `fill the week by hand`.

### 10. Nutrition dashboard (not yet backed by API)
**Purpose:** restrained and numeric. No rings, no streaks, no gamification.

- **Week totals strip** (hairline, `minmax(min(130px,100%),1fr)`): week kcal `15 240`
  "target 14 700–17 500" · protein `826 g` "target 910 g · 91%" (orange) · carbs `1 498 g` ·
  fat `553 g` (green).
- **Per-day table**, `grid-template-columns: 52px 1fr 62px 62px 62px 62px`,
  `min-width:560px` inside `overflow-x:auto`. Header row on `--bg-raised` with
  `.section-header` cells: day · "kcal vs 2100–2500" · kcal · p g · c g · f g.
  Each row: weekday (today in `--accent-text`); a 12px meter — `--bg-hover` track, fill
  width `kcal/3000`, fill color **orange under 2100, green in band, red over 2500,
  `--bg-hover` when unplanned**, plus a **target band overlay** drawn as two 1px
  `--border-hover` verticals at `2100/3000` and `2500/3000`; then kcal in the fill color and
  p/c/f dim. Unplanned days render `—`.
  Footer row on `--bg-raised`: `avg` + muted *"2 of 7 days below target · none above"* +
  `2 180 / 118 / 214 / 79`.
- Closing `--text-xs` muted caveat: *"planned days only — cooked entries use actual
  servings, planned ones the plan's. Freeform notes contribute nothing and are excluded
  (3 slots this week)."*

Seed days: ma 2240/132/218/82 · ti 1480/84/141/58 · ke 2310/118/246/78 · to
1620/96/158/61 · pe 2190/121/220/84 · la 2400/139/232/96 · su unplanned.

### 11. Waste report (not yet backed by API)
**Purpose:** feedback on planning, not scolding. Tone rule: state the pattern, propose the
fix, never moralize.

- **Stat strip:** last 30 days `980 g` "6 items · ~9,40 €" · trend `−38 %` (green) "vs the 30
  before" · worst category `produce` (orange) "herbs and leaves, 4 of 6".
- **Bar chart**, `.section-header` "grams expired per week", 80px tall flex row, one column
  per week: value label in `--text-xs` (red when >400 g), bar `height = g/520 × 56px` min
  3px, color **red >400 g, orange >200 g, else green**, week label muted below.
  Seed: W26 520 · W27 410 · W28 300 · W29 480 · W30 180 · W31 90 · W32 310 · W33 20.
- **Expired-unused list:** name + `--text-xs` muted detail (alias · location · shelf life),
  a `.label-muted` **reason**, right-aligned dim quantity. Rows: Dill 20 g "bought for one
  recipe" · Spinach 120 g "planned, thursday skipped" · Sour cream 100 ml "opened, half
  used" · Coriander 15 g "disliked — stop buying" · Rye bread 2 pcs "stale, 2 slices".
- **Pattern callout**, `border-left: 2px solid var(--accent)` on `--bg-raised`: *"Two
  patterns: **spinach** expired 3× — you buy 200 g and recipes use 80 g, so buy loose or
  plan a second spinach meal. And Thursdays get skipped 4 weeks running — the plan keeps
  assuming you cook after the late shift."*

## Interactions & Behavior

- **Navigation:** sidebar (desktop) / bottom tabs + More list (phone). Changing screen also
  closes any open modal. No routing in the prototype; add real routes
  (`/today`, `/pantry`, `/recipes/:id`, `/import`, `/plan`, `/suggest`, `/shopping`,
  `/nutrition`, `/waste`, `/profile`).
- **Servings scaler** (recipe detail and cook modal share one value): clamp 1–12; every
  ingredient quantity and every deduction recomputes on change.
- **Cook flow:** planned cell / `cook →` → confirm modal → `deduct & mark cooked` → closes,
  fires the success toast, opens the feedback modal. `cancel` and `mark skipped` close.
  Cooked entries are **terminal**: clicking one only explains why it's locked.
- **Shopping check-off:** whole row toggles; state keyed by `name + net`; `reset` clears;
  progress meter and group counters derive from it.
- **Toasts:** `.toast-success`, bottom-right, `toast-in .2s ease`; auto-dismiss after
  **2600 ms**, and tap-to-dismiss. Schedule the timer at the call site (a `say(msg)` helper)
  and clear the previous timer first — deriving it from a lifecycle diff leaked a permanent
  toast in the prototype.
- **Hover:** `.btn:hover → --bg-hover`; rows brighten via background only. Nothing on a
  phone-first screen is hover-only.
- **Loading:** `.loading` spinner rows + shimmer bars (import extraction, suggestion
  scoring).
- **Errors:** red-tinted panel with the failing request, an explicit "nothing was written"
  reassurance, a retry, and a manual fallback path.
- **Reduced motion:** base.css already neutralizes animation/transition durations under
  `prefers-reduced-motion: reduce`; don't reintroduce motion outside CSS.
- **Not wired in the prototype** (all toast "Mock — not wired to the API."): search,
  pantry add/edit/remove, recipe tag filters, ad-hoc shopping add, week navigation, fork,
  edit, reshuffle. These need real implementations.

## State Management

Prototype state, and what it maps to:

| key | values | notes |
|---|---|---|
| `view` | the 11 screen ids | becomes the route |
| `mode` | `desktop` / `phone` | prototype-only; real app uses media queries |
| `serv` | 1–12 | shared by recipe detail + cook modal |
| `rid` | recipe id | selected recipe |
| `loc` | `all/fridge/freezer/pantry/counter` | pantry filter (add `cat` for category) |
| `stage` | `input/loading/review` | import stage |
| `sug` | `ok/loading/error` | suggestion fetch state |
| `shop` | `full/empty` | mockup toggle; real app derives from list length |
| `bought` | `{ itemKey: 0|1 }` | shopping check-off |
| `cook`, `fb` | 0/1 | modal visibility |
| `fbPick` | `{ rating, effort, again, asis }` | feedback selections |
| `toast` | string | plus a timer handle |

**Data fetching the real app needs:** pantry list (sorted server-side by `expiresDate`),
recipe list + detail, plan for a week range, `POST /api/import/extract` (returns draft +
per-line match candidates), `POST /api/plan/:entry/cook` (returns applied deductions),
`POST /api/feedback`, `GET /api/shopping?week=`, `POST /api/suggest`, `GET /api/nutrition`,
`GET /api/waste`, profile read/write. Derived-on-read: pantry `status`, shopping `netToBuy`,
per-day nutrition totals.

**Domain rules to enforce in the client:**
- `status` derives from `expiresDate`, never stored.
- Deduction is FIFO by soonest expiry, and shows which lot it consumed.
- `cooked` is terminal; recipe and servings lock with it.
- `usedAsIs === false` ⇒ `changesNote` required.
- Unit conversion never crosses dimensions (mass `mg g kg` · volume `ml cl dl l tsp tbsp` ·
  count `piece pcs`, with Finnish aliases `tl rkl kpl`). The UI must not offer g→ml.
- Ingredient search matches `aliases[]` (`potato`/`peruna`).

## Assets

None. No images, no icon files, no illustrations — by design. The only external resources
are `https://mase.fi/base.css` and the two JetBrains Mono woff2 files it declares
(`JetBrainsMono-Regular.woff2`, `JetBrainsMono-Bold.woff2`). Glyphs are unicode geometric
characters; swap them for the codebase's line-icon set if one exists (follow base.css's
`.icon` contract).

## Files

- `Diet App.dc.html` — the full clickable prototype. All 11 screens, both modals, all
  loading/empty/error states, and every mock data structure (`PANTRY`, `RECIPES`, `RAMP`,
  suggestions, nutrition, waste, shopping) live in its `<script>` logic class. Read the data
  arrays straight out of it for fixtures.
- `brief-original.md` — the original product brief, including the data model with real field
  names and allowed values. Treat its field names as authoritative.

Prototype-only scaffolding to ignore when implementing: the top chrome bar and its
desktop/phone toggle, the import stage tabs, the suggestion state tabs, the shopping
empty-state toggle button.
