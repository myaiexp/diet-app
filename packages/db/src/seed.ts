import { config } from 'dotenv';
config({ path: '../../.env' });

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { eq } from 'drizzle-orm';
import { createDb } from './connection.js';
import { ingredients, userProfile } from './schema/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const db = createDb(connectionString);

  // Load ingredients data
  const dataPath = join(__dirname, '..', 'data', 'ingredients.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf-8'));

  console.log(`Loaded ${data.length} ingredients from JSON`);

  // Clear existing ingredients
  await db.delete(ingredients);
  console.log('Cleared existing ingredients');

  // Batch insert all ingredients
  await db.insert(ingredients).values(
    data.map((item: any) => ({
      name: item.name,
      aliases: item.aliases,
      category: item.category,
      defaultUnit: item.defaultUnit,
      nutritionPer100g: item.nutritionPer100g,
      shelfLife: item.shelfLife,
      tags: item.tags,
      isPantryStaple: item.isPantryStaple,
    }))
  );
  console.log(`Seeded ${data.length} ingredients`);

  // Create default user profile if none exists
  const existing = await db.select().from(userProfile).limit(1);
  if (existing.length === 0) {
    await db.insert(userProfile).values({
      name: 'Default User',
      householdSize: 1,
      cookingSkill: 'competent',
    });
    console.log('Created default user profile');
  } else {
    console.log('User profile already exists, skipping');
  }

  console.log('Done!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
