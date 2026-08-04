// Pure helpers for the demo seed: catalog name resolution, relative dates and
// the production-database guard. No I/O, no fixtures — split out of
// seed-demo.mjs to keep every file under the repo's 300-line limit.

// ---------------------------------------------------------------------------
// Ingredient name resolution
//
// The prototype's PANTRY/RECIPES arrays use plain-English, sometimes brand- or
// cut-specific names (design-tool copy, same caveat as the invented API
// endpoint names in the frontend design doc). The 462-row catalog
// (packages/db/data/ingredients.json) doesn't always carry that exact string.
// `matchIngredient` itself stays a strict, disciplined case-insensitive/trimmed
// match against `name` or an alias — no fuzzy matching, so a genuine gap fails
// loudly with the name in the message (see seed-demo.test.mjs). Below the
// fixture data is written using resolved catalog lookup keys, and this table
// documents every place a prototype name doesn't reach the catalog verbatim.
// Neither table nor pantry_items nor recipe_ingredients stores a free-text
// ingredient name (only ingredient_id), so choosing a different lookup key
// here costs zero display fidelity — the UI always renders the catalog's own
// name/alias at read time.
//
// Cosmetic renames — same foodstuff, catalog just spells/splits it differently:
//   "Dill"          -> "Fresh dill"        (catalog distinguishes fresh/dried; alias "tilli" is the prototype's own Finnish name for this item)
//   "Salmon fillet" -> "Salmon"            (catalog doesn't model cut)
//   "Bay leaf"      -> "Bay leaves"        (singular vs. plural)
//   "Wheat flour"   -> "All-purpose flour" (Finnish "vehnäjauho" is the catalog's alias for this entry)
//
// Substitutions — the catalog has no equivalent at all; nearest available
// stand-in used so the demo data is still cookable. Reported to the operator
// in the run summary, per the "report it, don't invent catalog rows" rule:
//   "Fish stock"        -> "Vegetable stock" (catalog has chicken/veg/beef stock only)
//   "Pork shoulder"     -> "Pork belly"      (no shoulder/roast cut in catalog)
//   "Beef chuck"        -> "Beef roast"      (closest slow-braise cut available)
//   "Cured salmon"      -> "Smoked salmon"   (no gravlax-style product in catalog)
//   "Forest mushrooms"  -> "Mushroom"        (catalog only has cultivated mushroom)
//   "Oltermanni cheese" -> "Swiss cheese"    (no Finnish semi-hard brand modeled; emmental-style is closest)
//   "Pearl barley"      -> "Barley"          (catalog doesn't distinguish pearled groats from whole barley)
export const CATALOG_SUBSTITUTIONS = {
  'Fish stock': 'Vegetable stock',
  'Pork shoulder': 'Pork belly',
  'Beef chuck': 'Beef roast',
  'Cured salmon': 'Smoked salmon',
  'Forest mushrooms': 'Mushroom',
  'Oltermanni cheese': 'Swiss cheese',
  'Pearl barley': 'Barley',
};

// Case-insensitive, trimmed match against the catalog's name or any alias.
// Never fuzzy, never silent: an unmatched name throws naming itself so a
// prototype/catalog drift is caught at seed time, not as a fabricated id
// silently written to the database.
export function matchIngredient(name, catalog) {
  const needle = name.trim().toLowerCase();
  const found = catalog.find((row) => {
    if (row.name.trim().toLowerCase() === needle) return true;
    return (row.aliases ?? []).some((alias) => alias.trim().toLowerCase() === needle);
  });
  if (!found) {
    throw new Error(`No catalog ingredient matches "${name}" (checked name + aliases, case-insensitive)`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Date helpers — everything below is relative to whatever "today" the script
// is run with, never a hardcoded date, so the spoilage ramp and the meal-plan
// week stay meaningful no matter when the demo gets (re)seeded.

// `daysFromToday` days after `today`, formatted as a Postgres `date` literal.
// Normalizes to UTC midnight first so the offset math can't drift a day from
// the caller's local timezone.
export function relativeDate(daysFromToday, today) {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + daysFromToday);
  return base.toISOString().slice(0, 10);
}

// Monday of the ISO week containing `today` (ISO weeks run Mon..Sun).
export function mondayOfIsoWeek(today) {
  const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const isoDay = base.getUTCDay() === 0 ? 7 : base.getUTCDay(); // 1=Mon .. 7=Sun
  base.setUTCDate(base.getUTCDate() - (isoDay - 1));
  return base;
}

// ---------------------------------------------------------------------------
// Database-name guard — refuses to run against anything but an obviously
// disposable database unless told to. Mirrors scripts/setup-test-db.sh's
// db_name_from_url shell logic in JS: strip scheme, drop the authority, drop
// the query string, drop any trailing path segment.
export function resolveDbName(connectionString) {
  const schemeIdx = connectionString.indexOf('://');
  const afterScheme = schemeIdx === -1 ? connectionString : connectionString.slice(schemeIdx + 3);
  const slashIdx = afterScheme.indexOf('/');
  const path = slashIdx === -1 ? '' : afterScheme.slice(slashIdx + 1);
  return path.split('?')[0].split('/')[0];
}

export function isGuardedDbName(name) {
  return name.endsWith('_test') || name.endsWith('_dev');
}

