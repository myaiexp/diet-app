// Unit tests for parseCorsOrigins — the env -> CORS allowlist parser
import { describe, test, expect } from 'vitest';
import { parseCorsOrigins } from '../config.js';

describe('parseCorsOrigins', () => {
  test('unset => production-safe default (mase.fi only)', () => {
    expect(parseCorsOrigins(undefined)).toEqual(['https://mase.fi']);
  });

  test('empty / whitespace-only => production-safe default', () => {
    expect(parseCorsOrigins('')).toEqual(['https://mase.fi']);
    expect(parseCorsOrigins('   ,  ')).toEqual(['https://mase.fi']);
  });

  test('parses and trims a comma-separated list', () => {
    expect(parseCorsOrigins('https://mase.fi, http://localhost:5173')).toEqual([
      'https://mase.fi',
      'http://localhost:5173',
    ]);
  });

  test('drops empty segments', () => {
    expect(parseCorsOrigins('https://mase.fi,,')).toEqual(['https://mase.fi']);
  });
});
