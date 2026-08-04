#!/usr/bin/env python3
"""Export an S-kaupat store's assortment (prices, nutrition, EANs) as JSON.

See docs/s-kaupat-api.md for how the API was mapped and what it does not cover
(notably: S-market Jämsänkoski has no online assortment; use S-market Jämsä).

    ./skaupat-export.py stores                        # find a store id
    ./skaupat-export.py dump 660919473 jamsa.json     # full assortment

A full dump is ~1000 requests and reliably outlives the WAF's patience, so it
checkpoints after every category and resumes from where it stopped. Re-run the
same command after a block clears and it picks up, keeping what it already had.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.s-kaupat.fi"
# CloudFront 403s without a browser-ish Origin; there is no auth beyond that.
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://www.s-kaupat.fi",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
}
PAGE_MAX = 120     # server caps limit here; larger silently returns nothing
OFFSET_MAX = 5000  # from >= this silently returns total:0, hence the category walk

# A short burst clears in ~90s, but a block earned by sustained volume (~750
# requests at 0.5s spacing) outlasts several minutes — hence the patient ceiling.
BACKOFF_START = 60.0
BACKOFF_MAX = 900.0
BACKOFF_ATTEMPTS = 8


class Blocked(Exception):
    """The WAF is still refusing us after the full backoff ladder."""


def gq(query, variables, throttle):
    """One GraphQL POST, backing off on the WAF's IP-level 403."""
    body = json.dumps({"query": query, "variables": variables}).encode()
    delay = BACKOFF_START
    for _ in range(BACKOFF_ATTEMPTS):
        time.sleep(throttle)
        try:
            req = urllib.request.Request(API, data=body, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read())
            break
        except urllib.error.HTTPError as err:
            if err.code != 403:
                raise
            # 403 arrives as a CloudFront HTML page, not a GraphQL error.
            print(f"  rate limited, sleeping {delay:.0f}s", file=sys.stderr, flush=True)
            time.sleep(delay)
            delay = min(delay * 1.5, BACKOFF_MAX)
    else:
        raise Blocked("still blocked after the full backoff ladder")
    if "errors" in payload:
        raise RuntimeError(payload["errors"][0]["message"])
    return payload["data"]


STORES = "query { stores { id name brand city } }"

NAV = """query($storeId: ID!) {
  store(id: $storeId) {
    navigation { id name slug
      children { id name slug
        children { id name slug } } } } }"""

PRODUCTS = """query($storeId: ID!, $slug: String, $from: Int, $limit: Int) {
  store(id: $storeId) {
    products(slug: $slug, from: $from, limit: $limit, includeAgeLimitedByAlcohol: true) {
      total
      items {
        ean sokId name brandName slug productType
        price priceUnit comparisonPrice comparisonUnit approxPrice frozen
        countryOfOrigin ingredientStatement description
        pricing {
          currentPrice regularPrice campaignPrice campaignPriceValidUntil
          lowest30DayPrice depositPrice salesUnit
        }
        nutrients { name value }
        hierarchyPath { name slug }
      }
    }
  } }"""


def leaf_slugs(items):
    """Flatten the category tree to its leaves — each stays under OFFSET_MAX."""
    out = []
    for item in items:
        children = item.get("children") or []
        out += leaf_slugs(children) if children else [item["slug"]]
    return out


def write_json(path, payload):
    """Write via a temp file so a kill mid-write cannot truncate the checkpoint."""
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    os.replace(tmp, path)


def cmd_stores(args):
    stores = gq(STORES, {}, args.throttle)["stores"]
    needle = (args.filter or "").lower()
    rows = [s for s in stores
            if not needle or needle in f"{s['name']} {s.get('city') or ''}".lower()]
    for s in sorted(rows, key=lambda s: s["name"]):
        print(f"{s['id']}\t{s['brand']}\t{s['name']}\t{s.get('city') or ''}")
    print(f"\n{len(rows)} of {len(stores)} e-commerce stores", file=sys.stderr)


def cmd_dump(args):
    state_path = args.state or f"{args.out}.state"
    products, done = {}, set()
    if os.path.exists(state_path):
        state = json.load(open(state_path, encoding="utf-8"))
        if state.get("storeId") != args.store_id:
            sys.exit(f"{state_path} holds a dump of store {state.get('storeId')}, "
                     f"not {args.store_id} — pass --state or remove it")
        products = {p["ean"]: p for p in state["products"]}
        done = set(state["done"])
        print(f"resuming: {len(done)} categories, {len(products)} products already in "
              f"{state_path}", file=sys.stderr)

    nav = gq(NAV, {"storeId": args.store_id}, args.throttle)["store"]["navigation"]
    if not nav:
        sys.exit(f"store {args.store_id} has no online assortment "
                 f"(navigation is null) — it is not an e-commerce store")
    categories = leaf_slugs(nav)
    todo = [c for c in categories if c not in done]

    try:
        for n, slug in enumerate(todo, 1):
            offset = 0
            while True:
                page = gq(PRODUCTS,
                          {"storeId": args.store_id, "slug": slug,
                           "from": offset, "limit": PAGE_MAX},
                          args.throttle)["store"]["products"]
                for item in page["items"]:
                    products[item["ean"]] = item
                offset += PAGE_MAX
                if offset >= min(page["total"], OFFSET_MAX):
                    break
            done.add(slug)
            write_json(state_path, {"storeId": args.store_id,
                                    "done": sorted(done),
                                    "products": list(products.values())})
            print(f"[{n}/{len(todo)}] {slug}: {page['total']} "
                  f"(unique so far {len(products)})", file=sys.stderr, flush=True)
    except (Blocked, KeyboardInterrupt) as err:
        print(f"\nstopped: {err or type(err).__name__}. "
              f"{len(products)} products kept in {state_path} — "
              f"re-run the same command to resume.", file=sys.stderr)
        return 1

    write_json(args.out, list(products.values()))
    os.remove(state_path)
    print(f"wrote {len(products)} products to {args.out}", file=sys.stderr)
    return 0


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--throttle", type=float, default=1.0, metavar="SEC",
                        help="delay between requests (default 1.0; 0.5 sustained "
                             "~750 requests before the WAF cut in)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("stores", help="list e-commerce stores")
    p.add_argument("filter", nargs="?", help="substring match on name or city")
    p.set_defaults(func=cmd_stores)

    p = sub.add_parser("dump", help="export a store's full assortment (resumable)")
    p.add_argument("store_id")
    p.add_argument("out")
    p.add_argument("--state", help="checkpoint path (default: <out>.state)")
    p.set_defaults(func=cmd_dump)

    args = parser.parse_args()
    sys.exit(args.func(args) or 0)


if __name__ == "__main__":
    main()
