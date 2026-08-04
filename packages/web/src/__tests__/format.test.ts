// Display formatting: quantities, Finnish dates, the expiry ramp

import { describe, test, expect } from 'vitest';
import { formatQuantity, formatNumber, toNumber } from '../format/quantity.js';
import {
  finnishWeekday,
  finnishWeekdayLong,
  finnishDate,
  daysRemainingLabel,
  daysUntil,
  mondayOf,
  addDays,
  isoWeekNumber,
} from '../format/date.js';
import { rampColor, statusLabel } from '../format/expiry.js';

describe('formatQuantity', () => {
  test('formats above 100 to the nearest 5', () => {
    expect(formatQuantity(402.5, 'g')).toBe('400 g');
    expect(formatQuantity(404, 'g')).toBe('405 g');
    expect(formatQuantity(1480, 'g')).toBe('1 480 g'); // space thousands separator
  });

  test('formats at or below 100 to one decimal with a comma', () => {
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
    expect(formatQuantity(20, 'g')).toBe('20 g'); // no trailing ,0
    expect(formatQuantity(0.25, 'l')).toBe('0,3 l');
  });

  test('formatNumber omits the unit', () => {
    expect(formatNumber(1480)).toBe('1 480');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  test('toNumber parses a numeric column safely', () => {
    expect(toNumber('400')).toBe(400);
    expect(toNumber(null)).toBe(0);
    expect(toNumber('not a number')).toBe(0);
  });
});

describe('dates', () => {
  test('names the weekday in Finnish', () => {
    expect(finnishWeekday('2026-08-04')).toBe('ti');
    expect(finnishWeekdayLong('2026-08-04')).toBe('tiistai');
    expect(finnishWeekday('2026-08-09')).toBe('su');
  });

  test('formats a short Finnish date', () => {
    expect(finnishDate('2026-08-04')).toBe('4.8.');
    expect(finnishDate('2026-12-31')).toBe('31.12.');
  });

  test('labels days remaining', () => {
    expect(daysRemainingLabel(-1)).toBe('1d ago');
    expect(daysRemainingLabel(0)).toBe('today');
    expect(daysRemainingLabel(1)).toBe('1 day');
    expect(daysRemainingLabel(3)).toBe('3 days');
    expect(daysRemainingLabel(59)).toBe('59 days');
    expect(daysRemainingLabel(90)).toBe('3 mo');
  });

  test('counts whole UTC days, matching the API status arithmetic', () => {
    const now = new Date('2026-08-04T21:30:00.000Z');
    expect(daysUntil('2026-08-04', now)).toBe(0);
    expect(daysUntil('2026-08-05', now)).toBe(1);
    expect(daysUntil('2026-08-03', now)).toBe(-1);
  });

  test('walks weeks for the plan toolbar', () => {
    expect(mondayOf('2026-08-04')).toBe('2026-08-03');
    expect(mondayOf('2026-08-09')).toBe('2026-08-03'); // Sunday closes the week
    expect(addDays('2026-08-03', 6)).toBe('2026-08-09');
    expect(isoWeekNumber('2026-08-04')).toBe(32);
  });
});

describe('expiry ramp', () => {
  test('maps every status to a ramp color', () => {
    expect(rampColor('use_soon').text).toBe('#e8a308'); // amber literal, not var(--accent)
    expect(rampColor('expired').text).toBe('var(--red)');
    expect(rampColor('use_today').text).toBe('var(--orange)');
    expect(rampColor('fresh').text).toBe('var(--green)');
  });

  test('tints only the two urgent rows', () => {
    expect(rampColor('expired').row).not.toBeNull();
    expect(rampColor('use_today').row).not.toBeNull();
    expect(rampColor('use_soon').row).toBeNull();
    expect(rampColor('fresh').row).toBeNull();
  });

  test('labels a status for the pill', () => {
    expect(statusLabel('use_today')).toBe('use today');
    expect(statusLabel('expired')).toBe('expired');
  });
});
