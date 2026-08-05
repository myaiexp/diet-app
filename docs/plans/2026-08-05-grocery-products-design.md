# Real grocery products from S-kaupat — design

Bring the S-market Jämsä assortment (17,126 products with prices and nutrition,
see `docs/s-kaupat-api.md`) into the database as first-class rows.

## Why products, not backfilled ingredients

The obvious move — overwrite `ingredients.nutritionPer100g` with measured values —
is wrong, and the data says so:

- The 462 seeded ingredients already hold **439 distinct, textbook-correct profiles**
  (potato 77 kcal, onion 40, garlic 149). They are sound reference data, not stubs.
- `ingredients` rows are *concepts*: `milk`, `butter`, `wheat flour`. A product is a
  SKU: `Kotimaista kevytmaito 1 L`, 1.5% fat. Writing that product's numbers onto the
  concept encodes one fat level into a row that recipes use generically. Skimmed and
  full-fat milk would fight over the same row.

Products and concepts are different things and want different tables. Measured
nutrition is true *of a product*, so that is where it goes.

## Schema

One new table — `packages/db/src/schema/products.ts`. Authoritative column list and
nullability live in that file; what matters here is the key.

**The natural key is the composite `(store_id, ean)`, not `ean` alone.** An EAN
identifies a product globally, but a *row* here is "this product, in this store's
assortment", and the same EAN carries a different price in a different store. Keying
on `ean` alone would make importing a second store silently overwrite the first
store's prices. A separate non-unique index on `ean` serves lookups that don't know
the store (an order line, a future barcode scan).

There is a second collision mode worth naming: store-internal EANs for loose produce
start with `2` and are assigned per chain, not globally (the loose banana is
`2000503600002`). Within S-group they are stable, so they work as keys here, but they
must never be treated as global identifiers.

`price` and `comparisonPrice` are `numeric`, which **Drizzle reads back as strings**.
The importer writes them as strings too — passing a JS number loses precision on the
way in. Note that unconstrained `numeric` preserves the written scale, so `1.5`
returns as `'1.5'`, not `'1.50'`; formatting is the caller's job.

Deliberately **not** included: `ingredient_id`. Mapping products to concepts is its
own problem (it needs the learn-once map discussed for pantry auto-population) and
nothing in this phase needs it. Adding a nullable FK now would invite half-populated
joins before the mapping rules exist.

`price` is a **snapshot**, and the column comment says so. Prices move; this table is
a catalog cache refreshed by re-import, not a price oracle.

### Migration

Schema changes go through `drizzle-kit generate` then `migrate` — never `push`, which
prompts and so hangs without a TTY (see CLAUDE.md). Applied as
`0002_keen_supreme_intelligence.sql`. The test database needs it too:
`pnpm --filter @diet-app/db setup:test-db`.

## Nutrient parsing

Better constrained than feared. Across all 17,126 products there are exactly **8
distinct nutrient names** and two value formats:

| S-kaupat name | target key | note |
| --- | --- | --- |
| `Energia` | `calories` + `energy_kj` | `"196 kJ / 47 kcal"` — **both** sides kept |
| `Proteiinia` | `protein_g` | |
| `Rasvaa` | `fat_g` | |
| `Hiilihydraattia` | `carbs_g` | |
| `Ravintokuitua` | `fiber_g` | present on 5,013 of 17,126 |
| `Suola` | `salt_g` | new key |
| `- josta tyydyttyneitä rasvoja` | `saturated_fat_g` | new key |
| `- josta sokereita` | `sugars_g` | new key |

Values are `<number><unit>` with a **Finnish decimal comma** (`"1,5 g"`, `"0 g"`).

**The unit is parsed and checked, not assumed.** The table above declares a
*dimension* (mass or energy) rather than a bare target key, and the unit handling is
derived from it: a mass value is converted into the grams its `_g` key promises
(`mg` ×1e-3, `µg` ×1e-6) and **refused** if the unit is unconvertible or absent.
Every non-energy nutrient in the current dump happens to be grams, so an
assume-grams parser would pass today and be wrong the first time an `mg` value
arrives under a known name — sodium is routinely labelled that way, and 500 mg
written as 500 g is off by a thousand. Absent is likewise not grams: a bare number
on a mass key is rejected.

Energy keeps **both** units. kJ is the EU's primary labelled figure and kcal the
secondary one, so taking only kcal discards the legally primary value for no reason.

The three new keys (`salt_g`, `saturated_fat_g`, `sugars_g`) are additive and safe.
`nutritionPer100g` is `jsonb`, and while `GET /api/ingredients` does serialize the
blob straight through to clients, **nothing computes with it** — `seed-core.ts` is
its only writer and no business logic reads the keys. Adding optional keys to a
pass-through blob breaks nothing. Salt in particular is worth capturing for a diet app.

Note these new keys land on `products.nutritionPer100g`, not on `ingredients` — the
existing 462 ingredient rows are untouched by this work.

Parsing is a pure function in `packages/db/src/nutrients.ts`, unit-tested against the
real formats. It is strict by design: an unrecognised name or an unparseable value is
skipped and counted, never guessed at, and the importer reports the totals. A silent
`0` would read as "this food contains no salt".

## Import

`pnpm --filter @diet-app/db import-products <export.json> <storeId>` — reads an export
produced by `scripts/skaupat-export.py`, parses nutrients, and upserts on the
`(store_id, ean)` conflict target using the same `excluded.*` idiom as `seed-core.ts`,
so re-import refreshes prices in place. Batched at 500 rows to stay well inside
Postgres's 65535 bind-parameter ceiling.

A row missing `ean` or `name` is **skipped and counted**, not written and not
synthesised: both are `notNull`, and inventing a key would create a row no later
import could ever match again. Unknown nutrient names are reported loudly at the end
of a run — that signals the upstream shape changed and the parser is now dropping a
field it used to understand.

The 29 MB dump is **not** committed; the script takes a path. Re-running the exporter
then the importer is the refresh path.

## Testing

- `nutrients.test.ts` — the 8 names, the dual-format energy string, the decimal comma,
  and the rejection cases (unknown name, unparseable value, missing nutrients array).
- `import-products.test.ts` — pure row-mapping: store scoping, numeric-as-string,
  the `hierarchyPath` reversal, null handling.
- `import-products-sql.test.ts` — **real Postgres**, because upsert behaviour lives
  entirely in `ON CONFLICT` and a mock would only prove `.onConflictDoUpdate()` was
  called. Covers re-import updating in place, the same EAN coexisting across two
  stores at different prices, jsonb round-tripping, and the missing-`ean` skip. Uses
  the established `TEST_DATABASE_URL` loud gate (opt out only via
  `DIET_APP_SKIP_DB_TESTS=1`) and loads the repo-root `.env` itself, as the api
  integration suite does — vitest does not load it.

## Out of scope

Product → ingredient mapping, pantry auto-population from order history, and pushing
shopping lists back to S-kaupat. All depend on this table existing first.
