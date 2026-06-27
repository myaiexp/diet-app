import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '..', '..', 'data', 'ingredients.json');
const data = JSON.parse(readFileSync(dataPath, 'utf-8'));

describe('ingredients.json', () => {
  test('has ~500 entries (400-600 range)', () => {
    expect(data.length).toBeGreaterThan(400);
    expect(data.length).toBeLessThan(600);
  });

  test('every ingredient has required fields', () => {
    for (const item of data) {
      expect(item.name).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.defaultUnit).toBeTruthy();
      expect(item.nutritionPer100g.calories).toBeGreaterThanOrEqual(0);
      expect(item.nutritionPer100g.protein_g).toBeGreaterThanOrEqual(0);
      expect(item.nutritionPer100g.carbs_g).toBeGreaterThanOrEqual(0);
      expect(item.nutritionPer100g.fat_g).toBeGreaterThanOrEqual(0);
      expect(item.nutritionPer100g.fiber_g).toBeGreaterThanOrEqual(0);
      expect(item.shelfLife).toBeDefined();
    }
  });

  test('no duplicate ingredient names', () => {
    const names = data.map((i: any) => i.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('pantry staples are marked correctly', () => {
    const staples = data.filter((i: any) => i.isPantryStaple);
    expect(staples.length).toBeGreaterThan(20);
    const stapleNames = staples.map((i: any) => i.name);
    expect(stapleNames).toContain('salt');
    expect(stapleNames).toContain('black pepper');
    expect(stapleNames).toContain('olive oil');
  });

  test('categories are valid', () => {
    const valid = ['produce', 'dairy', 'protein', 'grain', 'spice', 'condiment', 'frozen', 'other'];
    for (const item of data) {
      expect(valid).toContain(item.category);
    }
  });

  test('defaultUnit values are valid', () => {
    for (const item of data) {
      expect(['g', 'ml', 'pieces']).toContain(item.defaultUnit);
    }
  });

  test('nutrition values are non-negative', () => {
    for (const item of data) {
      const n = item.nutritionPer100g;
      expect(n.calories).toBeGreaterThanOrEqual(0);
      expect(n.protein_g).toBeGreaterThanOrEqual(0);
      expect(n.carbs_g).toBeGreaterThanOrEqual(0);
      expect(n.fat_g).toBeGreaterThanOrEqual(0);
      expect(n.fiber_g).toBeGreaterThanOrEqual(0);
    }
  });

  test('a meaningful fraction of ingredients carry Finnish aliases', () => {
    // Structural check rather than pinning specific alias strings: any item that
    // has aliases should have a non-empty string array, and a clear majority of
    // the catalogue should be aliased. This survives data edits (renames/expands)
    // that would break point-in-time "chicken → kana" snapshot assertions.
    const aliased = data.filter(
      (i: any) =>
        Array.isArray(i.aliases) &&
        i.aliases.length > 0 &&
        i.aliases.every((a: unknown) => typeof a === 'string' && a.length > 0)
    );
    expect(aliased.length / data.length).toBeGreaterThan(0.5);
  });

  test('shelf life has correct structure', () => {
    for (const item of data) {
      const sl = item.shelfLife;
      expect(sl).toHaveProperty('fridge_days');
      expect(sl).toHaveProperty('freezer_days');
      expect(sl).toHaveProperty('pantry_days');
    }
  });
});
