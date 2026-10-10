# Shopping lists

> Item keys, generation merge, per-day netting, `/complete`, aisle grouping, and
> staples. Design: `docs/plans/2026-08-04-shopping-lists-design.md`.
> `CLAUDE.md` keeps the map.

## Items are keyed by dimension and stored in the base unit

Shopping list items are keyed `(list, ingredient, dimension)` and stored in the
dimension's **base unit** (`g`/`ml`/`pieces`) — one ingredient can legitimately
be two rows (`900 g` *and* `2 pieces`), since `units.ts` never crosses
dimensions. `POST /:id/items` normalizes its unit and quantity before writing
(`1 kg` → `1000 g`); that is load-bearing, not cosmetic, because the unique
index is `(list_id, ingredient_id, unit)` and an un-normalized `kg` row would
sit beside a generated `g` row instead of colliding with it. Prettifying
`900 g` as `0.9 kg` is the client's job. Arithmetic is pure in
`shopping-aggregate.ts` (`aggregateShoppingList`); the route loads rows,
aggregates, and writes inside one transaction — the `cook-deduct.ts` split.

## Generation merges, never rebuilds

`POST /shopping-lists/generate` is gated on `status = 'draft'` → 409 otherwise.
The upsert rewrites `quantityNeeded`/`quantityInPantry`/`netToBuy`/`category`
on generated rows, except a row whose quantity the user has edited
(`quantityEdited`): that triple stays as the edit stored it, and only
`category` still refreshes. Refreshing coverage alone would mix the plan's
cap — coverage of the *plan's* demand — into a demand the user already
changed, and `/complete` would file that mix. `bought`, `customNote` and
`source` are user-owned and always survive; manual rows are never rewritten or
pruned. The prune deletes only `source='generated' AND bought=false` rows absent
from the fresh plan, **including** quantity-edited ones: the flag protects the
numbers, not the row. A generated row already bought stays even when the plan
drops it, because that food was purchased and `/complete` still needs it for the
pantry hand-off.

A quantity edit is `PATCH /items/:id` with `quantityNeeded` and/or `netToBuy`.
The server does not store the pair as sent. On a generated row `netToBuy`
becomes `max(0, quantityNeeded − quantityInPantry)` and coverage is capped at
the new demand, so the subtraction identity still holds and `/complete` files
that net rather than a stale one. On a manual row the two stay equal and
`quantityInPantry` stays 0 — the user typed what to buy. A pair that disagrees
is 400. `quantityEdited` is set only when a sent number differs from the stored
one: reaffirming the current demand heals a stale net without locking the row,
so the next regeneration can still refresh it. Deleting a generated row still
only removes it until the next regeneration. The body also takes an optional
`includeOptional` boolean (default false) that opts the recipes' `optional` lines
into the week's demand —
per-generation and never persisted on the list, because whether you want the
garnish is a fact about this shop, not about the week. It is the one knob here
that logic genuinely cannot decide.

## Netting is a per-day simulation

Not one week-wide subtraction (`shopping-aggregate.ts`). Demand accumulates per
`(ingredient, dimension, date)`; the week is then walked chronologically,
consuming pantry lots FEFO and letting each die on its own expiry — so a
yoghurt that spoils Wednesday no longer offsets a Saturday meal, which is how
the list used to under-buy. A lot's availability date is `max(entryDate, today)`:
that keeps the old "already spoiled as of today" exclusion (an entry earlier in
the current week must not resurrect stock that has since gone off) while adding
the forward-looking half.

Consequence, and the reason the field's name is now slightly off:
**`quantityInPantry` means "how much of this week's demand the pantry covers",
not "how much you have"** — it is capped at `quantityNeeded`, so surplus stock
no longer reads back in full. Once availability is date-dependent, "how much do
you have" has no single answer, and this is the only definition under which
`netToBuy = quantityNeeded − quantityInPantry` stays true. Generate computes
net from the two already-rounded figures in micro-units (`generatedNetToBuy`,
the arithmetic PATCH checks) so the identity holds on the stored values too, not
only before rounding — otherwise a both-fields PATCH of a fresh row could 400 on
a one-micro-unit drift. The client's row
line says `pantry covers 200 g · 200 g short` for exactly that reason.

## `done` is terminal

Reachable only via `POST /shopping-lists/:id/complete` — `PATCH /:id` can
neither set it nor leave it (re-sending the unchanged value passes), exactly
like `cooked` on meal plan entries and for the same reason: the transition
writes pantry rows that a plain status flip would skip, and terminality is what
makes double-add impossible. Deleting a `done` list is 409 — it is the only
record of a purchase — and so are item POST/PATCH/DELETE: a completed list is
the purchase record, and mutating a line after `/complete` would desync it from
the pantry rows just filed. `/complete` `FOR UPDATE`-locks the list then the
items so a concurrent item write cannot change the snapshot being filed. An item
whose ingredient has no shelf life for its resolved location is reported in
`skipped`, not fatal.

## Aisle order is grouped client-side

Grouping must never re-sort inside a group (`screens/shopping/groups.ts`). The
server sorts items non-staples-first, then category *alphabetically*, then name,
then id — alphabetical is not aisle order, so the screen buckets that array by
category (preserving arrival order within each bucket) and emits buckets as
`produce → protein → dairy → grain → condiment → spice → other`, unknown
categories appended in first-seen order. Bucketing rather than re-sorting is
what preserves the server's staples-last decision *inside* each aisle; sorting
server-side by aisle instead would split one category into two headers
(non-staple produce, then staple produce), which is why it stays a client
concern.

## `isPantryStaple` is user-owned

Toggled via `PATCH /api/ingredients/:id` (the only writable catalog column).
Generation treats staples like every other ingredient, and the list read sorts
them last (`shopping-sort.ts`) rather than filtering them out — a mis-set flag should put
an ingredient in the wrong group (one tap to fix) instead of making it vanish.
The flag is read live off the joined ingredient, never snapshotted onto the item
row. It is deliberately **excluded from the seed's `ON CONFLICT DO UPDATE` set**
(`seed-core.ts`) so a re-seed cannot wipe the curation; it stays in the insert
shape so new ingredients still get the initial guess.
