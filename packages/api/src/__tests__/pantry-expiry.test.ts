// Unit tests for create-path pantry expiry resolution from ingredient shelf life.

import { describe, test, expect } from 'vitest';
import { resolveExpiresDate } from '../pantry-expiry.js';

describe('resolveExpiresDate', () => {
  test('adds fridge_days to addedDate', () => {
    expect(
      resolveExpiresDate({ fridge_days: 5, freezer_days: 90 }, 'fridge', '2026-07-10'),
    ).toBe('2026-07-15');
  });

  test('returns null when key missing or null (e.g. counter)', () => {
    expect(resolveExpiresDate({ fridge_days: 5 }, 'counter', '2026-07-10')).toBeNull();
    expect(resolveExpiresDate({ counter_days: null }, 'counter', '2026-07-10')).toBeNull();
    expect(resolveExpiresDate(null, 'fridge', '2026-07-10')).toBeNull();
    expect(resolveExpiresDate(undefined, 'fridge', '2026-07-10')).toBeNull();
  });

  test('uses pantry_days for location pantry', () => {
    expect(
      resolveExpiresDate({ pantry_days: 14, fridge_days: 3 }, 'pantry', '2026-01-01'),
    ).toBe('2026-01-15');
  });

  test('returns null for non-finite or negative day counts', () => {
    expect(resolveExpiresDate({ fridge_days: -1 }, 'fridge', '2026-07-10')).toBeNull();
    expect(resolveExpiresDate({ fridge_days: Number.NaN }, 'fridge', '2026-07-10')).toBeNull();
  });

  test('zero days yields the same calendar date', () => {
    expect(resolveExpiresDate({ freezer_days: 0 }, 'freezer', '2026-03-01')).toBe('2026-03-01');
  });
});
