# Cook flow

> Preview, terminal `cooked`, FEFO deduction, and the feedback invariant. Design:
> `docs/plans/2026-07-20-cook-flow-design.md`. `CLAUDE.md` keeps the map.

## Skip is not a cook

`mark skipped` PATCHes `{ status: 'skipped' }` and hands the updated entry
back through the same `onCooked` callback the plan/today grids use to
refresh. It must not open the feedback modal, and it must not leave the
cell showing `planned`. `cooked` stays terminal via POST `/cook` only.

## Substituted is still a cook

`substituted` is a planning status (the recipe changed), not a cooked one.
Shopping still treats it as demand, POST `/cook` accepts it, and Today offers
`cook →`. Plan reopens the cell for edit instead of cooking. Skipped has no
Today CTA — un-skip from Plan.

## Preview is not a cook

`GET /meal-plans/:id/cook-preview` is the read-only twin of POST `/cook`. Optional
`?servings=` re-plans without persisting (integer 1–12, same cap as meal-plan
writes, recipe writes, and `GET /recipes/:id?servings=`). A stored entry
outside that range 400s on cook/preview rather than FEFO-draining the pantry.
There is no transaction and no
`FOR UPDATE` — a preview that locked rows would stall real cooks, and the pantry
may move before commit. The confirm modal always renders that payload; FEFO sort
keys live in `cook-deduct.ts` (soonest `expiresDate`, then opened-before-unopened,
then oldest `createdAt`, then lower `id`) and must not be recomputed on the
client. Ingredient names and lot dates are filled from `getRecipe` /
`listAllPantry` once on open; if either fails the modal still shows the preview
amounts, a visible degraded warning, and commit stays enabled — POST `/cook`
re-plans server-side. The POST `/cook` response is the source of truth; the
preview may be stale by then.

## Planned servings and actual servings are two numbers

`meal_plan_entries.servings` is what was *planned*. `actual_servings` is what
was *cooked*: `POST /meal-plans/:id/cook` takes an optional `{ servings }` body
(integer 1–12, same cap as everywhere else), plans the deduction at it, and
writes it to `actual_servings` — always, even with no body, so a cooked row
never has to be read as "null means the planned figure". `servings` is never
rewritten by a cook, which is what makes the planned/actual delta recoverable
for roadmap #390. Null `actual_servings` means the entry is not cooked (or was
cooked before the column existed).

The cook modal's stepper feeds that body. It must **not** PATCH `servings`
first: that destroyed the planned figure, and a PATCH-then-cook pair could leave
the entry re-planned but uncooked when the cook failed.

## `cooked` is terminal

`cooked` is reachable only via `POST /meal-plans/:id/cook` (PATCH cannot set or
leave it). Its body is optional — zero bytes parses as `{}` via
`parseJsonBody`'s `allowEmptyBody`, the one write route here that accepts an
absent body — but the request still sends `Content-Type: application/json`
so `csrfGuard` does not 415 it (finding #7991). PATCH cannot *change* `recipeId`, `substituteRecipeId`, or
`servings` on a cooked entry — the first two are inputs the deduction was
computed from, the third is the planned record it is compared against, and cook
409s so it can't be re-run to reconcile; re-sending an
unchanged value passes, and `date`/`slot`/`notes`/`freeformNote` stay editable.

Unit conversion lives in `units.ts` and never crosses dimensions. FEFO deduction
is pure in `cook-deduct.ts` (`planDeduction`); the cook route loads rows, plans,
and applies inside one `FOR UPDATE` transaction.

POST and PATCH share `hasContent`: a `recipeId`, a `substituteRecipeId`, or a
non-empty `freeformNote`. Cook already resolves `substituteRecipeId ?? recipeId`,
so a substitute-only row (demo Friday dinner) is not empty — including on
create. PATCH re-checks that rule against the merged row, not the patch alone.
The edit form writes the picker onto `substituteRecipeId` when status is
`substituted` and otherwise onto `recipeId` with `substituteRecipeId: null`, so
that resolution follows what the user picked. Clearing all three is a 400 with
the same `CONTENT_MSG` as POST.

## Cook feedback invariant

A `cook_feedback` row carries a `changesNote` iff `usedAsIs` is false. The patch
body alone can't be checked against it (the stored half is missing), so
`mergeFeedback(existing, patch)` in `meal-plan-feedback.ts` resolves the pair
once — flipping `usedAsIs` true drops a note the patch didn't mention, while a
note sent *alongside* `usedAsIs: true` stays a 400 rather than being silently
repaired. The handler validates that merged pair and writes that same pair;
never re-derive either half at the write.

The *rule* itself lives once, in `feedbackPairError(usedAsIs, changesNote)`
(`schemas/meal-plans.ts`): POST runs the parsed body through it via
`superRefine`, PATCH runs the merged pair through it, and both report the same
`NOTE_REQUIRED_MSG` / `NOTE_ABSENT_MSG`. Add a caller rather than a second copy
of the condition. The web modal's own inline message is deliberately separate —
it is user-facing copy from the frontend design, not the wire contract.
