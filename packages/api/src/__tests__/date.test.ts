// Unit tests for the ISO week-bounds helper and the ISO-date validator.

import { describe, test, expect } from 'vitest';
import { getISOWeekBounds } from '../date.js';
import { isIsoDate } from '../validation.js';

describe('getISOWeekBounds', () => {
  // The week containing 2026-03-05 runs Mon 2026-03-02 → Sun 2026-03-08.
  const WEEK = { monday: '2026-03-02', sunday: '2026-03-08' };

  test('Monday input is not adjusted backward', () => {
    expect(getISOWeekBounds('2026-03-02')).toEqual(WEEK);
  });

  test('mid-week (Thursday) input resolves to its Mon→Sun bounds', () => {
    expect(getISOWeekBounds('2026-03-05')).toEqual(WEEK);
  });

  test('Sunday input maps back to the same week (the -6 edge case)', () => {
    // Without the day===0 ? -6 branch, a Sunday would jump forward a week.
    expect(getISOWeekBounds('2026-03-08')).toEqual(WEEK);
  });

  test('handles a week that crosses a month boundary', () => {
    expect(getISOWeekBounds('2026-01-01')).toEqual({ monday: '2025-12-29', sunday: '2026-01-04' });
  });

  test('handles a week that crosses a year boundary', () => {
    expect(getISOWeekBounds('2026-12-31')).toEqual({ monday: '2026-12-28', sunday: '2027-01-03' });
  });
});

describe('isIsoDate', () => {
  test('accepts a real YYYY-MM-DD date', () => {
    expect(isIsoDate('2026-03-05')).toBe(true);
    expect(isIsoDate('2026-02-28')).toBe(true);
  });

  test('rejects non-date garbage', () => {
    expect(isIsoDate('foo')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  test('rejects wrong-shaped dates', () => {
    expect(isIsoDate('03-05-2026')).toBe(false);
    expect(isIsoDate('2026-3-5')).toBe(false);
    expect(isIsoDate('2026-03-05T00:00:00Z')).toBe(false);
  });

  test('rejects impossible-but-format-valid dates (V8 rolls these over)', () => {
    // new Date("2026-02-30") silently becomes Mar 02 — the round-trip check
    // catches it where a bare format regex would not.
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
  });
});
