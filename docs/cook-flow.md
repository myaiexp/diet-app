# Cook flow

> Terminal `cooked`, FEFO deduction, and the feedback invariant. Design:
> `docs/plans/2026-07-20-cook-flow-design.md`. `CLAUDE.md` keeps the map.

## `cooked` is terminal

`cooked` is reachable only via `POST /meal-plans/:id/cook` (PATCH cannot set or
leave it). PATCH also cannot *change* `recipeId`, `substituteRecipeId`, or
`servings` on a cooked entry — those are the exact inputs the deduction was
computed from, and cook 409s so it can't be re-run to reconcile; re-sending an
unchanged value passes, and `date`/`slot`/`notes`/`freeformNote` stay editable.

Unit conversion lives in `units.ts` and never crosses dimensions. FEFO deduction
is pure in `cook-deduct.ts` (`planDeduction`); the cook route loads rows, plans,
and applies inside one `FOR UPDATE` transaction.

## Cook feedback invariant

A `cook_feedback` row carries a `changesNote` iff `usedAsIs` is false. The patch
body alone can't be checked against it (the stored half is missing), so
`mergeFeedback(existing, patch)` in `meal-plan-feedback.ts` resolves the pair
once — flipping `usedAsIs` true drops a note the patch didn't mention, while a
note sent *alongside* `usedAsIs: true` stays a 400 rather than being silently
repaired. The handler validates that merged pair and writes that same pair;
never re-derive either half at the write.
