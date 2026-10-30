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

  test('staples are marked correctly', () => {
    const staples = data.filter((i: any) => i.isStaple);
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

  test('every ingredient carries at least one Finnish alias', () => {
    // Structural rather than pinning specific alias strings, so renames and
    // expansions do not break it. Every row, not a fraction: matching in
    // ingredient-match.ts is exact name-or-alias, so an English-only row is
    // unreachable from a Finnish recipe line — the catalogue's own language is
    // Finnish even though the canonical names are English. Idea #3391.
    const unaliased = data
      .filter(
        (i: any) =>
          !Array.isArray(i.aliases) ||
          i.aliases.length === 0 ||
          !i.aliases.every((a: unknown) => typeof a === 'string' && a.length > 0),
      )
      .map((i: any) => i.name);
    expect(unaliased).toEqual([]);
  });

  test('no string reaches two rows, except the one the matcher must ask about', () => {
    // Exact matching can only bind a string to one row, so a shared alias either
    // binds the wrong food or, since the matcher refuses to guess, costs a manual
    // pick on every import. `paprika` stays shared on purpose: it is the English
    // name of the spice and the Finnish name of the vegetable, and no catalog
    // edit can make one line mean both.
    const AMBIGUOUS_ON_PURPOSE = ['paprika'];
    const rowsByString = new Map<string, Set<string>>();
    for (const item of data) {
      for (const text of [item.name, ...item.aliases]) {
        const key = text.trim().replace(/\s+/g, ' ').toLowerCase();
        rowsByString.set(key, (rowsByString.get(key) ?? new Set()).add(item.name));
      }
    }
    const shared = [...rowsByString].filter(([, rows]) => rows.size > 1).map(([key]) => key);
    expect(shared).toEqual(AMBIGUOUS_ON_PURPOSE);
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
