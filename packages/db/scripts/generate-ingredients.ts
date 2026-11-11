// CLI: generates data/ingredients.json from the scripts/ingredients/ tables
// Run: tsx packages/db/scripts/generate-ingredients.ts [outPath]  (or `pnpm db:seed` to generate + seed)
// outPath defaults to packages/db/data/ingredients.json; the drift test passes a temp path.

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { GeneratedIngredient } from './ingredients/define.js';
import { produce } from './ingredients/produce.js';
import { protein } from './ingredients/protein.js';
import { dairy } from './ingredients/dairy.js';
import { grain } from './ingredients/grain.js';
import { spice } from './ingredients/spice.js';
import { condiment } from './ingredients/condiment.js';
import { frozen } from './ingredients/frozen.js';
import { other } from './ingredients/other.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// This order is the row order in ingredients.json; the seed upserts by name,
// so it only matters for keeping the committed file's diffs small.
const ingredients: GeneratedIngredient[] = [
  ...produce,
  ...protein,
  ...dairy,
  ...grain,
  ...spice,
  ...condiment,
  ...frozen,
  ...other,
];

// `name` is the seed's upsert key: a duplicate would silently collapse two rows.
const seen = new Set<string>();
const dupes = ingredients.map((i) => i.name).filter((n) => seen.has(n) || !seen.add(n));
if (dupes.length > 0) {
  console.error('Duplicate names found:', dupes);
  process.exit(1);
}

const perCategory = new Map<string, number>();
for (const i of ingredients) perCategory.set(i.category, (perCategory.get(i.category) ?? 0) + 1);

console.log(`Generated ${ingredients.length} ingredients`);
console.log(`Categories: ${[...perCategory].map(([k, v]) => `${k}:${v}`).join(', ')}`);
console.log(`Staples: ${ingredients.filter((i) => i.isStaple).length}`);
console.log(`With Finnish aliases: ${ingredients.filter((i) => i.aliases.length > 0).length}`);

const outPath = process.argv[2] ?? join(__dirname, '..', 'data', 'ingredients.json');
writeFileSync(outPath, JSON.stringify(ingredients, null, 2) + '\n');
console.log(`Written to ${outPath}`);
