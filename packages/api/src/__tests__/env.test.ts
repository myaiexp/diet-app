// Unit tests for the assertEnv required-env guard
import { describe, test, expect, vi, afterEach } from 'vitest';
import { assertEnv } from '../env.js';

const TEST_KEY = '__ASSERT_ENV_TEST__';

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env[TEST_KEY];
});

describe('assertEnv', () => {
  test('returns the value when the env var is set', () => {
    process.env[TEST_KEY] = 'hello';
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    expect(assertEnv(TEST_KEY)).toBe('hello');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test('exits 1 with a clear error when the env var is missing', () => {
    delete process.env[TEST_KEY];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    expect(() => assertEnv(TEST_KEY)).toThrow('process.exit called');
    expect(errorSpy).toHaveBeenCalledWith(`${TEST_KEY} not set`);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
