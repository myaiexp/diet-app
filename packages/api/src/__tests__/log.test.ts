// Unit tests for the recipe-import failure logger (describeError / logImportFailure)

import { describe, test, expect, vi, afterEach } from 'vitest';
import { describeError, logImportFailure } from '../ai/log.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('describeError', () => {
  test('renders name and message', () => {
    expect(describeError(new Error('boom'))).toBe('Error: boom');
  });

  test('appends status for API errors', () => {
    const err = Object.assign(new Error('Incorrect API key'), { status: 401 });
    expect(describeError(err)).toBe('Error: Incorrect API key status=401');
  });

  test('appends code for system errors', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    expect(describeError(err)).toContain('code=ECONNREFUSED');
  });

  test('unwraps cause — undici hides the real reason there', () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = Object.assign(
      new Error('getaddrinfo ENOTFOUND nope.invalid'),
      { code: 'ENOTFOUND' },
    );
    const out = describeError(err);
    expect(out).toContain('TypeError: fetch failed');
    expect(out).toContain('cause=Error: getaddrinfo ENOTFOUND nope.invalid');
    expect(out).toContain('code=ENOTFOUND');
  });

  test('passes strings through and stringifies other values', () => {
    expect(describeError('plain reason')).toBe('plain reason');
    expect(describeError({ a: 1 })).toBe('{"a":1}');
  });

  test('truncates very long detail so journald lines stay readable', () => {
    const out = describeError('x'.repeat(5000));
    expect(out.length).toBeLessThan(400);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('logImportFailure', () => {
  test('writes one prefixed line with context and cause', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logImportFailure('transport error', new Error('boom'), {
      url: 'https://example.com/r',
      hop: 0,
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toBe(
      '[recipe-import] transport error url=https://example.com/r hop=0: Error: boom',
    );
  });

  test('omits the cause segment when no detail is given', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logImportFailure('non-success status', undefined, { status: 503 });
    expect(spy.mock.calls[0]![0]).toBe('[recipe-import] non-success status status=503');
  });

  // Redaction sits in the sink, not the call sites: a rejected redirect target
  // and a raw Location header are both attacker-controlled, and any future
  // context field carrying a URL would leak the same way. Idea #3742.
  test('redacts userinfo from any URL-shaped context value', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logImportFailure('redirect target rejected', 'invalid_url', {
      url: 'https://alice:s3cret@example.com/recipe?a=1',
      location: 'http://bob:hunter2@evil.test/',
      hop: 1,
    });
    const line = spy.mock.calls[0]![0] as string;
    expect(line).not.toContain('s3cret');
    expect(line).not.toContain('hunter2');
    expect(line).toContain('url=https://***:***@example.com/recipe?a=1');
    expect(line).toContain('location=http://***:***@evil.test/');
    expect(line).toContain('hop=1');
  });

  test('redacts a username-only URL and leaves credential-free values alone', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logImportFailure('redirect target rejected', undefined, {
      url: 'https://alice@example.com/r',
      plain: 'https://example.com/r',
      host: 'example.com',
      relative: '/next/page',
    });
    const line = spy.mock.calls[0]![0] as string;
    expect(line).toContain('url=https://***@example.com/r');
    expect(line).toContain('plain=https://example.com/r');
    expect(line).toContain('host=example.com');
    expect(line).toContain('relative=/next/page');
  });
});
