# Pantry

> Storage locations, expiry derivation on create, client-owned expiry on PATCH,
> and the spoilage status bands. Design:
> `docs/plans/2026-07-20-pantry-recipe-writes-design.md`. Read-side joins and
> list order: `docs/api-conventions.md`. `CLAUDE.md` keeps the map.

## Locations are a closed set

`LOCATIONS` in `packages/api/src/pantry-location.ts` — `fridge`, `freezer`,
`pantry`, `counter` — is the single source. Pantry POST/PATCH
(`schemas/pantry.ts`) and the `/complete` overrides validate against it, and
`locationForCategory` (ingredient category → default location for
`/complete`; unknown categories fall to `pantry`) returns a member of it. The
`pantry_items.location` column is plain `text` with no CHECK, so those schemas
are the only gate. The web client keeps its own copy in
`packages/web/src/api/types.ts` `LOCATIONS`; adding a location means both.

## Expiry is derived on create, and only on create

POST without `expiresDate` stores `addedDate + shelfLife["<location>_days"]`
(`resolveExpiresDate`, `pantry-expiry.ts`), counted in UTC calendar days;
`addedDate` defaults to today's UTC date. A key that is missing, null,
negative, or non-finite means "no default", and POST answers
`400 'expiresDate is required when ingredient has no shelf life for this location'`.
The seed catalog (`packages/db/data/ingredients.json`) never sets
`counter_days`, so `location: counter` without an explicit date always 400s,
and many seed ingredients null out one of the other three keys as well. An
explicit `expiresDate` always wins, and nothing checks it against `addedDate`.

The web add modal (`modals/pantry-form.ts`) recognises that 400 by its exact
`error` string and only then reveals a date field. Changing the message in
`routes/pantry.ts` breaks that fallback without failing anything at compile
time — change both together.

`/complete` calls the same resolver with today's date and each item's resolved
location, but a null result skips the item (`skipped[].reason:
'no_shelf_life'`) instead of failing the request — see `docs/shopping-lists.md`.

## PATCH never recomputes expiry

After create, `expiresDate` belongs to the client. Changing `location`,
`addedDate`, or `opened` leaves the stored date as it is; a client that wants a
new date sends `expiresDate` itself (the edit modal always sends its date
field). Opened-driven shelf-life shortening is not implemented. The PATCH
schema is `.strict()`, so `ingredientId` cannot change (wrong ingredient →
delete + create); an empty body is 400; `updatedAt` is bumped on every write.

## Status is computed per response, in whole UTC days

Every pantry response carries `status` from `computeStatus(expiresDate)`
(`pantry-status.ts`). It is computed on each response and never stored. With
`d` = the expiry's UTC date minus today's UTC date, in days:

| `d`   | `status`    |
| ----- | ----------- |
| < 0   | `expired`   |
| 0–1   | `use_today` |
| 2–3   | `use_soon`  |
| > 3   | `fresh`     |

`use_today` includes tomorrow. Both sides are UTC calendar dates: a bare
`YYYY-MM-DD` parses as UTC midnight, and comparing it against local midnight
would shift same-day expiry by the server's UTC offset. The web renders the
API's `status` (`format/expiry.ts` is render-only); its days-remaining text is
display arithmetic on top and never replaces `status`.

## Other writers

- **Cook** (`POST /meal-plans/:id/cook`) FEFO-deducts lots and deletes a lot
  whose quantity reaches 0 — `docs/cook-flow.md`.
- **`/complete`** files one row per bought item with `opened: false` and
  `addedDate` today — `docs/shopping-lists.md`.
- **DELETE** `/pantry/:id` is a hard delete (204).
