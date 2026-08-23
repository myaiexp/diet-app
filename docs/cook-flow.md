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
`?servings=` re-plans without persisting; there is no transaction and no
`FOR UPDATE` — a preview that locked rows would stall real cooks, and the pantry
may move before commit. The confirm modal always renders that payload; FEFO sort
keys live in `cook-deduct.ts` (soonest `expiresDate`, then opened-before-unopened,
then oldest `createdAt`) and must not be recomputed on the client. The POST
`/cook` response is the source of truth; the preview may be stale by then.

## `cooked` is terminal

`cooked` is reachable only via `POST /meal-plans/:id/cook` (PATCH cannot set or
leave it). The POST is body-less but still sends `Content-Type: application/json`
so `csrfGuard` does not 415 it (finding #7991). PATCH also cannot *change* `recipeId`, `substituteRecipeId`, or
`servings` on a cooked entry — those are the exact inputs the deduction was
computed from, and cook 409s so it can't be re-run to reconcile; re-sending an
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
