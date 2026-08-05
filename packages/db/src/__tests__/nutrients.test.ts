// Parser tests for the S-kaupat nutrient strings — the exact formats the live
// API returns (see docs/s-kaupat-api.md), including the ones we refuse to guess at.

import { describe, test, expect } from 'vitest';
import { parseNutrients, parseNutrientValue } from '../nutrients.js';

describe('parseNutrientValue', () => {
  test('reads a Finnish decimal comma', () => {
    expect(parseNutrientValue('1,5 g')).toBe(1.5);
  });

  test('reads an integer with no decimal part', () => {
    expect(parseNutrientValue('0 g')).toBe(0);
  });

  test('takes the kcal side of a dual-unit energy string', () => {
    expect(parseNutrientValue('196 kJ / 47 kcal')).toBe(47);
  });

  test('handles a kcal value with a decimal comma', () => {
    expect(parseNutrientValue('1508 kJ / 361,5 kcal')).toBe(361.5);
  });

  test('tolerates missing space between number and unit', () => {
    expect(parseNutrientValue('4,8g')).toBe(4.8);
  });

  test('returns null rather than guessing at an unparseable value', () => {
    expect(parseNutrientValue('')).toBeNull();
    expect(parseNutrientValue('<0,5 g')).toBeNull();
    expect(parseNutrientValue('ei sisällä')).toBeNull();
  });

  // A "0" for an absent value would read as "this food contains no salt", which is
  // a different and worse claim than "we don't know".
  test('never coerces an unparseable value to zero', () => {
    expect(parseNutrientValue('n/a')).not.toBe(0);
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

  test('maps all eight known names onto the target keys', () => {
    const out = parseNutrients([...milk, { name: 'Ravintokuitua', value: '0,4 g' }]);
    expect(out.nutrition).toEqual({
      calories: 47,
      fat_g: 1.5,
      saturated_fat_g: 1,
      carbs_g: 4.8,
      sugars_g: 4.8,
      protein_g: 3.5,
      salt_g: 0.1,
      fiber_g: 0.4,
    });
  });

  test('omits keys the product does not declare', () => {
    const out = parseNutrients(milk);
    expect(out.nutrition).not.toHaveProperty('fiber_g');
    expect(out.nutrition?.calories).toBe(47);
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
    expect(out.nutrition).toEqual({ calories: 47 });
    expect(out.unknownNames).toEqual(['Vitamiini D']);
  });

  test('counts unparseable values instead of writing a wrong number', () => {
    const out = parseNutrients([
      { name: 'Energia', value: '196 kJ / 47 kcal' },
      { name: 'Suola', value: '<0,01 g' },
    ]);
    expect(out.nutrition).toEqual({ calories: 47 });
    expect(out.unparseable).toEqual([{ name: 'Suola', value: '<0,01 g' }]);
    expect(out.nutrition).not.toHaveProperty('salt_g');
  });

  test('yields null nutrition when nothing at all could be parsed', () => {
    const out = parseNutrients([{ name: 'Vitamiini D', value: '1,2 µg' }]);
    expect(out.nutrition).toBeNull();
    expect(out.unknownNames).toEqual(['Vitamiini D']);
  });
});
