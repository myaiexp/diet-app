// Unit tests for the Postgres error-code predicates (23503 / 23505)

import { describe, test, expect } from 'vitest';
import { isFkViolation, isUniqueViolation } from '../pg-errors.js';
// pgError is the shape the route suites throw at their write mocks — the same
// shape postgres.js and node-pg raise, with `code` on the error itself. Five
// route modules turn that into a 400/409 instead of an unhandled 500, so what
// these predicates *reject* matters as much as what they accept: a false
// negative is a lost race surfacing as a crash.
import { pgError } from './db-mock.js';

describe('isFkViolation', () => {
  test('true for 23503, on an Error and on a bare object', () => {
    expect(isFkViolation(pgError('23503'))).toBe(true);
    expect(isFkViolation({ code: '23503' })).toBe(true);
  });

  test('false for every other code', () => {
    for (const code of ['23505', '23502', '23514', '42P01', '']) {
      expect(isFkViolation(pgError(code)), code).toBe(false);
    }
  });

  test('false for a numeric code — Postgres SQLSTATEs are strings', () => {
    expect(isFkViolation({ code: 23503 })).toBe(false);
  });

  test('false for non-objects and for an error carrying no code', () => {
    for (const value of [null, undefined, '23503', 23503, false, new Error('boom')]) {
      expect(isFkViolation(value), String(value)).toBe(false);
    }
  });

  test('false when the code is only nested — the check is one level deep', () => {
    // Drivers put `code` at the top level; a wrapper that buries it would slip
    // past here and reach the route as a 500. Pinned so that a driver or
    // Drizzle change wrapping errors fails this test rather than production.
    expect(isFkViolation({ cause: { code: '23503' } })).toBe(false);
    expect(isFkViolation(new Error('wrapped', { cause: pgError('23503') }))).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  test('true for 23505, on an Error and on a bare object', () => {
    expect(isUniqueViolation(pgError('23505'))).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  test('false for every other code, including the FK one', () => {
    for (const code of ['23503', '23502', '40001', '']) {
      expect(isUniqueViolation(pgError(code)), code).toBe(false);
    }
  });

  test('false for non-objects and for an error carrying no code', () => {
    for (const value of [null, undefined, '23505', 23505, false, new Error('boom')]) {
      expect(isUniqueViolation(value), String(value)).toBe(false);
    }
  });
});
