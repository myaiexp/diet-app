// Unit tests for computeStatus spoilage classification (audit #1699)

// Pin the timezone so date-only expiry strings and the injected `now`
// normalize to the same calendar day regardless of the host TZ.
process.env.TZ = 'UTC';

import { describe, test, expect } from 'vitest';
import { computeStatus } from '../routes/pantry.js';

// Fixed reference instant: noon UTC on a non-DST-transition day, so day-diffs
// are stable integers and the tests are deterministic.
const NOW = new Date('2026-06-15T12:00:00Z');

// Build a 'YYYY-MM-DD' expiry string `days` away from NOW's calendar date,
// matching the shape Drizzle returns for a `date` column.
function expiry(days: number): string {
  const d = new Date('2026-06-15T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('computeStatus', () => {
  test('expired: expiry was yesterday', () => {
    expect(computeStatus(expiry(-1), NOW)).toBe('expired');
  });

  test('use_today: expiry is today (0 days)', () => {
    expect(computeStatus(expiry(0), NOW)).toBe('use_today');
  });

  test('use_today: expiry is tomorrow (1 day, inclusive boundary)', () => {
    expect(computeStatus(expiry(1), NOW)).toBe('use_today');
  });

  test('use_soon: expiry is 2 days out', () => {
    expect(computeStatus(expiry(2), NOW)).toBe('use_soon');
  });

  test('use_soon: expiry is 3 days out (inclusive boundary)', () => {
    expect(computeStatus(expiry(3), NOW)).toBe('use_soon');
  });

  test('fresh: expiry is 4 days out (first fresh day)', () => {
    expect(computeStatus(expiry(4), NOW)).toBe('fresh');
  });

  test('fresh: expiry is well in the future', () => {
    expect(computeStatus(expiry(30), NOW)).toBe('fresh');
  });
});
