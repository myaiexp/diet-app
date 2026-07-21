// Unit tests for parseCorsOrigins and parseAiConfig
import { describe, test, expect } from 'vitest';
import { parseCorsOrigins, parseAiConfig } from '../config.js';

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

describe('parseAiConfig', () => {
  test('parseAiConfig returns null when any required field missing', () => {
    expect(parseAiConfig({})).toBeNull();
    expect(parseAiConfig({ AI_API_KEY: 'k' })).toBeNull();
    expect(parseAiConfig({ AI_API_KEY: 'k', AI_BASE_URL: 'https://api.example' })).toBeNull();
    expect(
      parseAiConfig({
        AI_API_KEY: 'k',
        AI_BASE_URL: '',
        AI_MODEL_CAPABLE: 'm',
      }),
    ).toBeNull();
  });

  test('parseAiConfig trims and returns config when all present', () => {
    expect(
      parseAiConfig({
        AI_API_KEY: '  key  ',
        AI_BASE_URL: ' https://api.example/v1 ',
        AI_MODEL_CAPABLE: ' capable-model ',
      }),
    ).toEqual({
      apiKey: 'key',
      baseUrl: 'https://api.example/v1',
      modelCapable: 'capable-model',
    });
  });

  test('parseAiConfig ignores AI_MODEL_FAST for readiness', () => {
    expect(
      parseAiConfig({
        AI_API_KEY: 'k',
        AI_BASE_URL: 'https://api.example',
        AI_MODEL_CAPABLE: 'm',
        AI_MODEL_FAST: 'fast-only',
      }),
    ).toEqual({
      apiKey: 'k',
      baseUrl: 'https://api.example',
      modelCapable: 'm',
    });
    // Fast alone never makes AI ready
    expect(
      parseAiConfig({
        AI_API_KEY: 'k',
        AI_BASE_URL: 'https://api.example',
        AI_MODEL_FAST: 'fast',
      }),
    ).toBeNull();
  });
});
