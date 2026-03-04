# Tech Stack — Synthesized Plan

## Comparison Summary

### Convergence (all three agree)

Strong consensus across models on several key choices:

- **PWA over native apps**: All three recommend a Progressive Web App. Single codebase, installable on home screen, no app store friction, works on both desktop and mobile. The app is primarily used at home, so native device features aren't needed.
- **Tailwind CSS for styling**: Universal recommendation. Fast iteration, responsive by default, no debates.
- **PostgreSQL as the database**: All three recognize the data is deeply relational. "Show me recipes I can make with expiring pantry items that meet my macro targets" is a SQL query — doing that in a document store would be painful.
- **Supabase for managed PostgreSQL**: All three mention Supabase as the primary database option. Free tier covers personal use, gives you hosted Postgres + auth + real-time subscriptions out of the box.
- **Claude API for AI features**: Universal recommendation for the primary LLM. Best reasoning for complex meal planning.
- **Vercel for frontend hosting**: All three recommend it for zero-config deployment. Free tier is sufficient.
- **USDA FoodData Central / Open Food Facts**: Mentioned by all for nutrition data and ingredient seeding.

### Divergence (decision points)

**1. Frontend framework: Next.js vs. SvelteKit**

- Sonnet 4.5: Next.js (React), no alternatives mentioned.
- Opus 4.6: Next.js (App Router specifically), with detailed reasoning about unified codebase benefits.
- Opus 4.5: SvelteKit as primary recommendation, Next.js as alternative. Argues for smaller bundle and better DX.

**Recommendation**: Next.js. Two of three models recommend it, the React ecosystem is larger (more tutorials, libraries, StackOverflow answers), and as a solo developer without industry experience, having the most available learning resources matters more than theoretical DX improvements. SvelteKit is genuinely excellent, but betting on the larger ecosystem reduces the number of problems you'll have to solve alone.

**2. UI component library**

- Sonnet 4.5: Tailwind only (build components from scratch).
- Opus 4.6: Tailwind + shadcn/ui (pre-built accessible components).
- Opus 4.5: Tailwind only.

**Recommendation**: Tailwind + shadcn/ui. Building every button, dropdown, and modal from scratch is a time sink for a solo developer. shadcn/ui gives you solid, accessible components that you copy into your project (not a dependency you're locked into). It's a significant time-saver for the planner grid, recipe cards, shopping list checkboxes, and all the form inputs this app needs.

**3. ORM: Prisma vs. Drizzle**

- Sonnet 4.5: Prisma.
- Opus 4.6: Drizzle or Prisma (no strong preference).
- Opus 4.5: Not specified.

**Recommendation**: Prisma. It has more comprehensive documentation, a more intuitive schema language, and better learning resources. Drizzle is lighter and closer to SQL, which is great if you already know SQL well. For someone learning as they build, Prisma's abstractions are more forgiving.

**4. State management**

- Sonnet 4.5: Zustand or React Query.
- Opus 4.6: Not specified (implied server-state via Next.js).
- Opus 4.5: Not applicable (SvelteKit recommendation).

**Recommendation**: React Query (TanStack Query) for server state (API calls, data fetching, caching). It handles loading states, error states, cache invalidation, and refetching — all things you'd otherwise build manually. Zustand can be added later if you need complex client-side state, but React Query covers most of what this app needs since the data lives in the database.

**5. Local-first vs. cloud-first architecture**

This is the biggest architectural divergence:

- Opus 4.5: Strongly advocates local-first. IndexedDB via Dexie.js for local storage, SQLite as an alternative, sync via file or simple server. "Data lives locally first, syncs when convenient. You should be able to use this app on a plane."
- Sonnet 4.5: Cloud-first via Supabase. No mention of local storage.
- Opus 4.6: Cloud-first via Supabase, with PWA service worker caching for offline access to the current week's plan and shopping list.

**Recommendation**: Cloud-first with selective offline caching (Opus 4.6's approach). Here's why:

- A true local-first architecture with sync is significantly more complex to build and debug than a straightforward cloud setup. Conflict resolution, sync queues, and offline-to-online transitions are hard problems.
- Supabase gives you a working backend in minutes. IndexedDB + Dexie.js + a custom sync layer is weeks of infrastructure work.
- The app is used at home, where you have WiFi. Offline use is a nice-to-have for the shopping list in the store, not a core requirement.
- PWA service worker caching of the current meal plan + shopping list covers the realistic offline scenario without the complexity of a full local-first architecture.

If offline becomes genuinely important later, it can be added incrementally. Starting local-first and later needing cloud features is harder than starting cloud-first and adding offline caching.

**6. Local LLM option**

- Opus 4.5: Proposes a hybrid approach — Ollama + Mistral for simple local tasks (privacy, offline), Claude API for complex reasoning.
- Sonnet 4.5: Claude API only, with model tiering (Haiku for simple, Sonnet for complex).
- Opus 4.6: Claude API only, with model tiering and aggressive caching.

**Recommendation**: Claude API only for v1. Model tiering (fast/cheap model for parsing, capable model for planning) handles the cost concern. A local LLM adds significant setup complexity (Ollama installation, model management, prompt differences between models) for marginal benefit in a personal app where privacy isn't a major concern and offline AI use is niche. If API costs become a real problem, reconsider then.

**7. Auth approach**

- Sonnet 4.5: Supabase Auth or NextAuth.js.
- Opus 4.6: Supabase Auth or NextAuth, start with email/password.
- Opus 4.5: Not specified (local-first approach implies minimal auth).

**Recommendation**: Supabase Auth. Since you're already using Supabase for the database, using their auth keeps the stack simpler — one fewer service to configure. Email/password is sufficient for a personal app. If you ever expand to multi-user, Supabase Auth scales to that without migration.

**8. Hosting: Vercel vs. VPS vs. Cloudflare**

- Sonnet 4.5: Vercel (free tier).
- Opus 4.6: Vercel or a single VPS with Docker (more control, potentially cheaper long-term).
- Opus 4.5: Vercel or Cloudflare Pages.

**Recommendation**: Vercel. Zero-config Next.js deployment, free tier covers personal use, and you avoid the operational overhead of managing a VPS. Docker and VPS management is a separate skill set that doesn't help you build the app. Revisit if you outgrow the free tier or need more backend control.

### Unique suggestions

**From Opus 4.6:**
- **shadcn/ui** specifically named — concrete component library choice that the others left vague.
- **VPS with Docker** as a long-term alternative to Vercel — worth knowing about but not for v1.
- **Drizzle** as an ORM option — lighter weight, closer to SQL.

**From Opus 4.5:**
- **Local LLM via Ollama** — interesting for privacy/offline but premature.
- **SQLite as a simple portable option** — valid for a truly local app, but we're going cloud-first.
- **Dexie.js for IndexedDB** — good library if local-first is ever needed.

**From Sonnet 4.5:**
- **Cloudflare R2 for file storage** (receipt photos) — cheaper than S3, good to know about. But Supabase Storage is simpler to integrate when already using Supabase.
- **`recipe-scrapers` Python library** — specific tool recommendation for recipe import. Requires a Python microservice or serverless function if the main app is Next.js.

---

## Synthesized Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **Framework** | Next.js (App Router) | Unified codebase (frontend + API routes), largest ecosystem, most learning resources |
| **Styling** | Tailwind CSS + shadcn/ui | Fast iteration + pre-built accessible components |
| **State management** | React Query (TanStack Query) | Server state management, caching, loading/error states |
| **Database** | PostgreSQL via Supabase | Relational data, free tier, managed hosting, real-time subscriptions |
| **ORM** | Prisma | Type-safe, intuitive schema language, best documentation |
| **Auth** | Supabase Auth | Integrated with DB, email/password for personal use |
| **AI** | Anthropic Claude API | Model tiering: fast model for parsing, capable model for planning |
| **Hosting** | Vercel | Zero-config Next.js deployment, free tier sufficient |
| **Nutrition data** | USDA FoodData Central | Free, well-structured, comprehensive |
| **Recipe import** | Recipe parser library + AI fallback | Structured extraction from URLs, AI normalizes ingredient names |
| **Mobile** | PWA | Installable, offline caching for plan + shopping list, no app store |

### Architecture notes

- **Monorepo**: Single Next.js project with API routes colocated with pages. No separate backend service until complexity demands it.
- **Offline strategy**: Service worker caches the current week's meal plan and shopping list. Everything else requires connectivity. This is not a local-first app — it's a cloud app with smart caching.
- **File storage**: Supabase Storage for any future image needs (receipt photos, recipe images). Not needed for v1.
- **Recipe parsing**: If using a Python library like `recipe-scrapers`, deploy as a Vercel serverless function (Python runtime) or a small Supabase Edge Function. Alternatively, use AI to parse recipe pages directly — slower and more expensive per call, but no separate service to maintain.

---

## Open Questions for Phase 3

1. **Recipe parsing approach**: Dedicated parser library (more reliable, requires Python runtime) vs. AI-based extraction (simpler infrastructure, higher per-call cost, potentially less reliable for edge cases)?

2. **Supabase free tier limits**: 500MB database, 50,000 monthly active users, 500MB file storage. Sufficient for personal use, but worth monitoring as the recipe collection and meal plan history grow.

3. **React Query vs. Next.js Server Components**: Next.js App Router has built-in server-side data fetching. How much of the data layer should use Server Components vs. client-side React Query? This is an implementation detail but worth deciding early to avoid mixing patterns.
