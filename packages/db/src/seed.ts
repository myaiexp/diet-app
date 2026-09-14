// CLI entry point: load ingredients.json and seed the database (`pnpm seed`).

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createDb } from './connection.js';
import { loadRepoEnv } from './load-env.js';
import { resolveConnectionString, seedDatabase, type IngredientSeedRow } from './seed-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  loadRepoEnv();
  const connectionString = resolveConnectionString(process.env);

  const dataPath = join(__dirname, '..', 'data', 'ingredients.json');
  const rawIngredients = JSON.parse(readFileSync(dataPath, 'utf-8')) as IngredientSeedRow[];
  console.log(`Loaded ${rawIngredients.length} ingredients from JSON`);

  const db = createDb(connectionString);
  try {
    const result = await seedDatabase(db, rawIngredients);
    console.log(`Upserted ${result.ingredientCount} ingredients`);
    console.log(
      result.profileCreated
        ? 'Created default user profile'
        : 'User profile already exists, skipping',
    );
    console.log('Done!');
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
