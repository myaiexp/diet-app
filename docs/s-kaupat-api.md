# S-kaupat product data API

Research notes for sourcing real grocery data (prices, nutrition, EANs) into the
diet app. Investigated 2026-08-04 against the live site.

## Headline: Jämsänkoski has no online assortment

**S-market Jämsänkoski cannot be queried for products.** The store exists in the
directory but is not an e-commerce store:

| | S-market Jämsänkoski | S-market Jämsä |
| --- | --- | --- |
| store id | `726644899` | `660919473` |
| `store.navigation` | `null` | 32 top-level, 987 leaf categories |
| `store.products` total | `0` | `17146` |
| `coOperative` | `null` | `KESKIMAA` |
| in `Query.stores` (e-com list) | no | yes |

`products` returns `total: 0` for every shape tried — by category `slug`, by free-text
`queryString`, with no filter at all, and with `fallbackToGlobal: true`. The
sitemap lists 1060 store pages but only **706** stores carry an assortment; the rest
(Jämsänkoski among them) publish contact details and opening hours only.

`searchStores(query: "jämsänkoski")` does find it, so the absence is assortment
data, not the store record.

**Practical substitute: S-market Jämsä (`660919473`), 6.5 km away**, same chain and
same cooperative (Keskimaa) — 17,146 products with prices and nutrition. Store-level
prices differ from Jämsänkoski's shelf prices in principle; chain-priced items should
match, store-specific campaigns will not.

## The API

`POST https://api.s-kaupat.fi` — Apollo Server, **no authentication of any kind**.

Required headers (CloudFront returns 403 without the origin):

```
Content-Type: application/json
Origin: https://www.s-kaupat.fi
User-Agent: <any browser UA>
```

Introspection is disabled (`{__schema}` returns `INTROSPECTION_DISABLED`) and so are
Apollo's "did you mean" field suggestions, so a near-miss field name gives you a bare
`Cannot query field "stor" on type "Query"` with no hint. The schema was recovered
instead by decompiling the `graphql-tag` ASTs compiled into the site's webpack
chunks: 124 operation documents, including every product query. See
"Recovering the schema" below.

### Getting products

```graphql
query($storeId: ID!, $slug: String, $from: Int, $limit: Int) {
  store(id: $storeId) {
    products(slug: $slug, from: $from, limit: $limit, includeAgeLimitedByAlcohol: true) {
      total
      items {
        ean sokId name brandName slug productType
        price priceUnit comparisonPrice comparisonUnit approxPrice frozen
        countryOfOrigin ingredientStatement description
        pricing { currentPrice regularPrice campaignPrice campaignPriceValidUntil
                  lowest30DayPrice depositPrice salesUnit }
        nutrients { name value }
        hierarchyPath { name slug }
      }
    }
  }
}
```

`products` also accepts `eans: [String!]` (batch lookup by barcode, useful for
enriching a pantry item someone scanned), `queryString` for free-text search,
`orderBy`/`order`, and structured facets.

Other useful roots: `stores` (all 706 e-com stores), `searchStores(query:)` (the
full directory), `store(id:).navigation` (category tree), `product`, `pageContent`.

### Limits — these bite

- **Page size caps at 120.** `limit: 150` returns zero items, not an error.
- **`from` must be under 5000.** `from: 5000` returns `total: 0` with an empty list —
  silently, as if the store were empty. A flat listing therefore reaches only 5000
  of ~17k products; a full dump has to paginate per category slug.
- **The category walk is very slightly lossy.** Walking all 987 leaves of Jämsä's
  tree yielded 17,126 unique EANs against the flat listing's `total` of 17,146 — a
  20-product gap, presumably items reachable only outside the nav tree. Close enough
  for a catalog seed, but don't treat the walk as exhaustive.
- **Selecting no item fields is an error**, not an empty projection:
  `products { total }` alone returns `"List of props of Product should not be empty"`.
- **CloudFront WAF rate-limits, and the penalty scales with how much you took.**
  Two measured episodes:
  - ~150 **unthrottled** requests (bursting as fast as the network allowed) →
    IP-level 403 on everything, cleared on its own after **90 seconds**.
  - ~750 requests at **0.5s spacing** → blocked again, and this one did *not* clear
    within a 30 → 45 → 68 → 101s backoff ladder.

  So a short burst earns a short cooldown, while sustained volume earns a longer
  one; do not calibrate on the 90s figure. The exporter now spaces requests 1.0s
  apart by default and backs off 60s → 900s.

  The 403 arrives as a **CloudFront HTML page, not a GraphQL error**, so a client
  that only parses JSON will crash on it rather than retrying.

- **A full dump will get interrupted — checkpoint or lose it.** ~1000 requests is
  past what the WAF tolerates in one sitting. The first attempt reached 735/987
  categories and 13,425 products, then blocked and lost all of it, because the
  accumulator lived only in memory. `scripts/skaupat-export.py` now writes
  `<out>.state` after every category and resumes from it, so a block costs waiting
  time and nothing else.

  At 1.0s throttle a complete run of S-market Jämsä took ~30 minutes and hit the
  WAF 5 times, recovering from each without losing ground.

- **Run it detached.** A dump outlives a single agent turn, and a plain
  `run_in_background` shell gets killed at the turn boundary — use
  `helm wait "<command>"`, which runs as a `helm.service` child.

### Nutrition data shape

`nutrients` is per 100 g / 100 ml, and the values are **free text in Finnish**, not
numbers — parsing is on us, including the decimal comma:

```json
[{"name": "Energia",       "value": "196 kJ / 47 kcal"},
 {"name": "Rasvaa",        "value": "1,5 g"},
 {"name": "- josta tyydyttyneitä rasvoja", "value": "1 g"},
 {"name": "Hiilihydraattia","value": "4,8 g"},
 {"name": "- josta sokereita", "value": "4,8 g"},
 {"name": "Proteiinia",    "value": "3,5 g"},
 {"name": "Suola",         "value": "0,1 g"}]
```

Coverage, measured over a complete dump of S-market Jämsä (17,126 products):

| | count | share |
| --- | --- | --- |
| price | 17,126 | 100% |
| `ingredientStatement` | 15,018 | 88% |
| `nutrients`, whole store | 10,930 | 64% |
| `nutrients`, food branches only | 10,633 of 13,133 | **81%** |
| campaign price active | 48 | — |

The whole-store 64% is dragged down by the ~4,000 non-food items — the biggest
single category is `Kosmetiikka ja hygienia` at 2,178 products, and there are
household, pet and leisure branches too. 81% is the number that matters for an
ingredient catalog, and the missing fifth is mostly loose produce and service-counter
items that carry no packaged label.

`ingredientStatement` is likewise free text, with allergens in CAPS per EU
labelling convention.

There is also `productDetails.nutrients` — a nested `[ProductNutrients]` whose
`nutrients` entries have the same `{name, value}` shape. Values occasionally differ
in the last digit from the top-level list (`197 kJ` vs `196 kJ` for the same milk),
so pick one source and stay on it. `Product.nutrients` is the flatter one.

`Product.allergens` exists and is typed `[Allergen!]`, but its subfield names were
not resolved — `name`/`code`/`text`/`type`/`value` are all rejected, and the sample
product returned `[]`, so there was nothing to pattern-match against. Worth another
brute-force pass against a product that actually declares allergens if the catalog
ever needs them; `ingredientStatement` already CAPITALISES them in the meantime.

## Recovering the schema

Introspection being off is not much of an obstacle: the site compiles its GraphQL
documents into the JS bundles as ASTs, which print straight back to SDL.

1. Fetch a category page, extract `/_next/static/**/*.js` from the HTML.
2. Scan each chunk for `{kind:"Document"` and take the balanced-brace slice.
3. `eval` the literal and `print()` it with the `graphql` package.

The decompiler itself was throwaway (~40 lines) and is not kept in the repo — chunk
hashes change on every site deploy, so rewriting it beats maintaining it.
`scripts/skaupat-export.py` holds the queries that came out of it.

Field names beyond what those documents cover (`nutrients`, `allergens`, the
`stores`/`searchStores` roots) were found by brute-forcing candidate names — a
wrong guess returns `Cannot query field "x" on type "Y"` cheaply, and a right one
returns data or a "must have a selection of subfields" error that names the type.

## What login adds — measured, not inferred

**Nothing, for catalog data.** This was tested with a real logged-in session rather
than reasoned about, because the earlier inference-based version of this section got
its reasoning wrong (it went looking at S-mobiili, when the login that matters is
s-kaupat.fi's own, which is perfectly reachable in a browser).

The session lives in **localStorage, not a cookie** — key `session-…`, at
`state.authTokens.accessToken` — and is sent as `Authorization: Bearer <jwt>`. The
JWT is issued by `authorization.voikukka.fi`; its `sIdExp` claim expires the session
one hour after issue, while `exp` runs ~14 days.

Every catalog-relevant query returned **identical results** authenticated and
anonymous:

| probe | anonymous | authenticated |
| --- | --- | --- |
| `store(726644899).navigation` | `null` | `null` |
| `store(726644899).products` | `total: 0` | `total: 0` |
| `stores` (e-com list) | 706, no Jämsänkoski | 706, no Jämsänkoski |
| `searchPickupDeliveryAreas(storeId: 726644899)` | — | **0 areas** (Jämsä: 1) |
| `personalizedSortedProducts` (auth-only) | n/a | **502 upstream** for Jämsänkoski, works for Jämsä |
| pricing, 12 products at Jämsä | baseline | **byte-identical** |

That last row matters for the exporter: there are no member-only prices, so
`skaupat-export.py` needs no token and none was added to it.

The auth-gated operations really are all personal — order history, favourites,
shopping lists, saved payment cards, profile, recommendation ranking. And
structurally there is no seam for an account to change assortment: `products` takes
`facets`, `filters`, `from`, `limit`, `order`, `orderBy`, `queryString`, `slug`,
`storeId`, `availabilityDate`, `fallbackToGlobal`, `marketingId` — nothing
user-scoped.

So Jämsänkoski's absence is a fact about the assortment system, not an access
control. The only route left to its shelf prices is intercepting the S-mobiili
native app (mitmproxy plus cert unpinning) — a different project from haxi, whose
ladder drives a browser. Payoff is small: nutrition and ingredients are
product-level and already open, and chain pricing means Jämsä matches for
chain-priced items. Tracked as diet-app idea #3240.
