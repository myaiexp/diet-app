// Parser tests for the S-kaupat nutrient strings — the exact formats the live
// API returns (see docs/s-kaupat-api.md), including the ones we refuse to guess at.

import { describe, test, expect } from 'vitest';
import { parseNutrients, parseQuantity, parseEnergy } from '../nutrients.js';

describe('parseQuantity', () => {
  test('reads a Finnish decimal comma, and captures the unit', () => {
    expect(parseQuantity('1,5 g')).toEqual({ value: 1.5, unit: 'g' });
  });

  test('reads an integer with no decimal part', () => {
    expect(parseQuantity('0 g')).toEqual({ value: 0, unit: 'g' });
  });

  test('tolerates missing space between number and unit', () => {
    expect(parseQuantity('4,8g')).toEqual({ value: 4.8, unit: 'g' });
  });

  test('captures sub-gram units rather than swallowing them', () => {
    expect(parseQuantity('500 mg')).toEqual({ value: 500, unit: 'mg' });
    expect(parseQuantity('1,2 µg')).toEqual({ value: 1.2, unit: 'µg' });
  });

  test('returns null rather than guessing at an unparseable value', () => {
    expect(parseQuantity('')).toBeNull();
    expect(parseQuantity('<0,5 g')).toBeNull();
    expect(parseQuantity('ei sisällä')).toBeNull();
  });

  // A "0" for an absent value would read as "this food contains no salt", which is
  // a different and worse claim than "we don't know".
  test('never coerces an unparseable value to zero', () => {
    expect(parseQuantity('n/a')).not.toBe(0);
  });
});

describe('parseEnergy', () => {
  // The EU labels energy in kJ first; kcal is the secondary figure. Keeping only
  // kcal throws away the primary unit, so both are read.
  test('keeps both sides of a dual-unit energy string', () => {
    expect(parseEnergy('196 kJ / 47 kcal')).toEqual({ kj: 196, kcal: 47 });
  });

  test('handles decimal commas on either side', () => {
    expect(parseEnergy('1508,5 kJ / 361,5 kcal')).toEqual({ kj: 1508.5, kcal: 361.5 });
  });

  test('reads a kJ-only string', () => {
    expect(parseEnergy('196 kJ')).toEqual({ kj: 196, kcal: null });
  });

  test('reads a kcal-only string', () => {
    expect(parseEnergy('47 kcal')).toEqual({ kj: null, kcal: 47 });
  });

  test('returns null when neither unit is present', () => {
    expect(parseEnergy('47')).toBeNull();
    expect(parseEnergy('')).toBeNull();
  });
});

describe('parseNutrients', () => {
  const milk = [
    { name: 'Energia', value: '196 kJ / 47 kcal' },
    { name: 'Rasvaa', value: '1,5 g' },
    { name: '- josta tyydyttyneitä rasvoja', value: '1 g' },
    { name: 'Hiilihydraattia', value: '4,8 g' },
    { name: '- josta sokereita', value: '4,8 g' },
    { name: 'Proteiinia', value: '3,5 g' },
    { name: 'Suola', value: '0,1 g' },
  ];

  test('maps all eight known names onto the target keys, keeping both energy units', () => {
    const out = parseNutrients([...milk, { name: 'Ravintokuitua', value: '0,4 g' }]);
    expect(out.nutrition).toEqual({
      calories: 47,
      energy_kj: 196,
      fat_g: 1.5,
      saturated_fat_g: 1,
      carbs_g: 4.8,
      sugars_g: 4.8,
      protein_g: 3.5,
      salt_g: 0.1,
      fiber_g: 0.4,
    });
  });

  // The key asserts grams. A value arriving in mg must be converted, never written
  // through — sodium is routinely labelled in mg, and 500 stored as grams is 1000x.
  test('converts sub-gram units into the grams the key name promises', () => {
    const out = parseNutrients([{ name: 'Suola', value: '500 mg' }]);
    expect(out.nutrition).toEqual({ salt_g: 0.5 });
  });

  test('converts micrograms too', () => {
    const out = parseNutrients([{ name: 'Suola', value: '2500 µg' }]);
    expect(out.nutrition).toEqual({ salt_g: 0.0025 });
  });

  // Refusing beats guessing: an unconvertible unit on a mass key means the upstream
  // shape changed, and writing the bare number would be a silent magnitude error.
  test('rejects a unit it cannot convert instead of assuming grams', () => {
    const out = parseNutrients([{ name: 'Suola', value: '3 IU' }]);
    expect(out.nutrition).toBeNull();
    expect(out.unparseable).toEqual([{ name: 'Suola', value: '3 IU' }]);
  });

  test('rejects a bare number on a mass key — no unit is not the same as grams', () => {
    const out = parseNutrients([{ name: 'Rasvaa', value: '1,5' }]);
    expect(out.nutrition).toBeNull();
    expect(out.unparseable).toHaveLength(1);
  });

  test('omits keys the product does not declare', () => {
    const out = parseNutrients(milk);
    expect(out.nutrition).not.toHaveProperty('fiber_g');
    expect(out.nutrition?.calories).toBe(47);
  });

  test('a kJ-only energy string yields energy_kj without inventing calories', () => {
    const out = parseNutrients([{ name: 'Energia', value: '196 kJ' }]);
    expect(out.nutrition).toEqual({ energy_kj: 196 });
  });

  test('returns null nutrition when the product declares none', () => {
    expect(parseNutrients([]).nutrition).toBeNull();
    expect(parseNutrients(null).nutrition).toBeNull();
    expect(parseNutrients(undefined).nutrition).toBeNull();
  });

  test('counts unknown names instead of dropping them silently', () => {
    const out = parseNutrients([
      { name: 'Energia', value: '196 kJ / 47 kcal' },
      { name: 'Vitamiini D', value: '1,2 µg' },
    ]);
    expect(out.nutrition).toEqual({ calories: 47, energy_kj: 196 });
    expect(out.unknownNames).toEqual(['Vitamiini D']);
  });

  test('counts unparseable values instead of writing a wrong number', () => {
    const out = parseNutrients([
      { name: 'Energia', value: '196 kJ / 47 kcal' },
      { name: 'Suola', value: '<0,01 g' },
    ]);
    expect(out.nutrition).toEqual({ calories: 47, energy_kj: 196 });
    expect(out.unparseable).toEqual([{ name: 'Suola', value: '<0,01 g' }]);
    expect(out.nutrition).not.toHaveProperty('salt_g');
  });

  test('yields null nutrition when nothing at all could be parsed', () => {
    const out = parseNutrients([{ name: 'Vitamiini D', value: '1,2 µg' }]);
    expect(out.nutrition).toBeNull();
    expect(out.unknownNames).toEqual(['Vitamiini D']);
  });
});
