# Web conventions

> Layout, mount lifecycle, API client, `ui/` primitives, and CSS layering for
> `packages/web` (Vite + vanilla TS, no framework). Look, layout and copy:
> `docs/plans/2026-08-04-frontend-design.md` (not authoritative for the API —
> see its provenance header). Test harness: `docs/testing.md`. `CLAUDE.md`
> keeps the map.

## Source layout

| Dir | Holds |
| --- | ----- |
| `src/screens/<feature>/` | `index.ts` exports the `Screen` factory registered in `router.ts`; sibling files are that screen's row/panel builders. `screens/profile.ts` stays a single file. |
| `src/modals/` | Modals, including the cook flow. `cook-flow.ts` is what other screens call (confirm → cook → feedback). |
| `src/api/` | One thin module per resource over `client.ts`; wire types in `types.ts`. |
| `src/format/` | Display-only formatting (dates, quantities, the expiry ramp, entry titles). A formatted value is never sent back. |
| `src/ui/` | Shared primitives — see below. |
| `src/css/` | `app.css`, `form.css`, one sheet per screen — see CSS layering. |

## Routing and the mount lifecycle

- `ROUTES` in `router.ts` is the closed route set and `Route` is derived from
  it. An unknown path renders `/today` and is replaced in the address bar too.
- `/suggest`, `/nutrition`, `/waste` render `placeholderScreen` — no endpoint
  yet (#380, #385, #389) — so the nav stays complete. Swap the placeholder
  entry in `SCREENS` for a real factory when the endpoint lands.
- Each render mounts into a fresh `.screen-mount` node, so a mount that
  finishes after the user moved on writes into a detached tree.
  `ctx.isStale()` turns true once the mount is superseded;
  `ctx.setSubtitle` already ignores stale calls.
- Screen loads go through `loadInto` (`ui/async.ts`): it paints a loading row,
  does nothing after the await if `isStale()`, and replaces the container with
  a retry panel on failure unless `onError` handles it. Pass `ctx.isStale`;
  never keep a module-local `destroyed` flag.
- Anything a mount registers after an await (timers, handles) is torn down in
  `unmount()`. The router calls `unmount()` again when a superseded mount
  finishes late (`router-stale-mount.test.ts`).
- Screens reach the shell only through `ScreenContext`; `activeShell()` is the
  router's. Navigating (and `popstate`) closes any open modal.

## API client

- Every request goes through `apiGet` / `apiSend` (`api/client.ts`):
  same-origin `/api`, and no `Authorization` header — nginx injects it
  (`docs/auth-deploy.md`).
- Mutating requests always send `Content-Type: application/json`, even with no
  body, or `csrfGuard` 415s them (finding #7991).
- Every request carries `AbortSignal.timeout`: `REQUEST_TIMEOUT_MS` 25s (above
  the pool's 20s `query_timeout`); recipe import passes `IMPORT_TIMEOUT_MS`
  45s (fetch-url 10s + AI 30s). A new slow endpoint passes `timeoutMs` to
  `apiSend` rather than raising the default.
- A 401 calls `onSessionExpired`, which reloads the page so the edge gate
  redirects to login; the call still throws `ApiError(401)`. It is never shown
  as a message. Why `/api/` answers 401 instead of redirecting:
  `docs/auth-deploy.md`.
- Failures are `ApiError(status, body)`. `userMessage(e)` (`api/errors.ts`) is
  the one place a failure becomes user-facing copy (timeout, network, 5xx
  wording, else the API's `error` string); `fieldErrors(e)` flattens Zod
  `details`. Screens don't map statuses to text themselves.
- A collection needed whole drains through `fetchAllPages`
  (`listAllRecipes`, `listAllPantry`) at `PAGE_LIMIT` 200, the API's clamp.
  Asking for more gets 200 rows back, which reads as a short page, so the
  drain would stop after one page and silently truncate. The pantry screen
  does not drain: it pages 50 at a time with load-more.

## The server decides; the client renders

- Server order is kept: the pantry list is never re-sorted (spoilage order
  with an id tie-break is what keeps paging consistent), and shopping groups
  by bucketing, never sorting (`docs/shopping-lists.md`).
- Server-computed values are rendered, not recomputed: pantry `status`
  (`docs/pantry.md`), scaled recipes via `GET /recipes/:id?servings=N`, the
  cook preview's FEFO lots (`docs/cook-flow.md`), and `expiresDate` on create.
- `format/units.ts` `baseUnit` mirrors the API's `units.ts`; keep them equal.

## `ui/` primitives

| File | Provides |
| ---- | -------- |
| `dom.ts` | `el(tag, attrs, ...children)`, `button`, `append`, `errorPanel`, `loadingRow`. Strings become text nodes — never `innerHTML`. `false`/null children are dropped, so `cond && el(...)` works. |
| `async.ts` | `loadInto` (above). |
| `modal.ts` | `openModal({ title, meta?, body, footer?, width?, onClose? })` → handle; `closeModal()`. One modal at a time, Escape, focus trap. |
| `form.ts` | `field`, `textInput`, `errorBox` / `showError` / `hideError`. Imports `form.css`. |
| `toast.ts` | `say(msg, kind)` — one toast, 2600ms; the previous timer is cleared at the call site. |
| `shell.ts` | `mountShell` (sidebar / phone tab bar, header, badges, footer) and `activeShell()`, which is null in a test that mounts a screen bare. |
| `placeholder.ts` | `placeholderScreen` — what is missing and which roadmap item blocks it. |
| `ingredient-picker.ts` | Debounced catalog search + pick-then-quantity form, shared by pantry, shopping, profile, and import. |
| `recipe-or-note.ts` | Recipe XOR freeform-note picker for the plan modals. |

## CSS layering

1. `https://mase.fi/base.css` — linked in `index.html` with SRI. A `base.css`
   change needs a new integrity hash (the comment in `index.html`,
   `docs/auth-deploy.md`).
2. `src/css/app.css` — the project layer: tokens (cyan accent,
   `--ramp-amber`) and shared surfaces (modal chrome, `.bar-sticky`
   background, extra label tints, touch sizing). It is the first import in
   `main.ts`, ahead of the router that pulls in every screen, which is what
   puts it before the screen sheets in the bundle — keep it first.
3. `src/css/form.css` — imported by `ui/form.ts`, so any screen using form
   chrome gets it. Its `.pantry-field` / `.pantry-search-*` names are the
   shared form vocabulary despite the prefix.
4. One sheet per screen, imported by that screen's `index.ts` (or
   `screens/profile.ts`); `cook.css` by `modals/cook-confirm.ts`. A screen
   sheet holds only rules particular to that screen, and its header comment
   names the shared classes that live upstream.

The spoilage ramp colours live in `format/expiry.ts` with a literal amber, not
`var(--accent)`, so a re-theme cannot move them.
