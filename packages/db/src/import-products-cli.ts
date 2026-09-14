// CLI entry: loads an S-kaupat store export into the products table

import { readFileSync } from 'fs';
import { createDb } from './connection.js';
import { loadRepoEnv } from './load-env.js';
import { resolveConnectionString } from './seed-core.js';
import { importProducts, type ExportedProduct } from './import-products.js';

loadRepoEnv();

const USAGE = `usage: pnpm --filter @diet-app/db import-products <export.json> <storeId>

  <export.json>  output of scripts/skaupat-export.py dump
  <storeId>      the store the export came from, e.g. 660919473 (S-market Jämsä)

The dump is not committed — regenerate it with:
  ./scripts/skaupat-export.py dump <storeId> <export.json>`;

async function main() {
  const [path, storeId] = process.argv.slice(2);
  if (!path || !storeId) {
    console.error(USAGE);
    process.exit(2);
  }

  let items: ExportedProduct[];
  try {
    items = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Could not read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (!Array.isArray(items)) {
    console.error(`${path} is not a product array — expected the output of skaupat-export.py`);
    process.exit(1);
  }

  const db = createDb(resolveConnectionString(process.env));
  try {
    const result = await importProducts(db, items, storeId);
    console.log(`Imported ${result.imported} products for store ${storeId}`);
    console.log(`  with nutrition: ${result.withNutrition}`);
    if (result.skipped > 0) console.log(`  skipped (no ean/name): ${result.skipped}`);
    // Loud on purpose: an unknown nutrient name means upstream changed shape and
    // the parser is now silently dropping a field it used to understand.
    const unknown = Object.entries(result.unknownNutrients);
    if (unknown.length > 0) {
      console.warn(`  UNKNOWN nutrient names (${unknown.length}) — nutrients.ts needs updating:`);
      for (const [name, count] of unknown.sort((a, b) => b[1] - a[1])) {
        console.warn(`    ${count}x ${name}`);
      }
    }
    if (result.unparseableValues > 0) {
      console.warn(`  unparseable nutrient values: ${result.unparseableValues} (left unset, not zeroed)`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
