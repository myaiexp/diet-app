// Abort/timeout coverage for fetchUrlAsText (fake timers, no network)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUrlAsText } from '../ai/fetch-url.js';
import {
  captureImportLogs,
  htmlResponse,
  mustNotFetch,
  publicDns,
} from './fetch-url-test-util.js';

let logged: string[] = [];

beforeEach(() => {
  logged = captureImportLogs().logged;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchUrlAsText timeout', () => {
  test('aborts a DNS lookup that never resolves', async () => {
    const pending = fetchUrlAsText('https://example.com/x', {
      fetchImpl: mustNotFetch(),
      dnsLookup: () => new Promise(() => {}),
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged.some((l) => /timed out|dns lookup failed/.test(l))).toBe(true);
    expect(logged.some((l) => /abort/i.test(l))).toBe(true);
  });

  test('aborts a fetch that never settles', async () => {
    const pending = fetchUrlAsText('https://example.com/x', {
      fetchImpl: () => new Promise(() => {}),
      dnsLookup: publicDns,
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(logged.some((l) => /timed out/.test(l))).toBe(true);
    expect(logged.some((l) => /abort/i.test(l))).toBe(true);
  });

  test('aborts a body that stalls after headers', async () => {
    const pending = fetchUrlAsText('https://example.com/x', {
      fetchImpl: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('<p>start</p>'));
            // Never close — a trickle/stall after headers.
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
      dnsLookup: publicDns,
      timeoutMs: 20,
    });
    await vi.advanceTimersByTimeAsync(25);
    const result = await pending;
    expect(result).toEqual({ ok: false, error: 'fetch_failed' });
    expect(
      logged.some((l) => /timed out|aborted mid-body/.test(l)),
    ).toBe(true);
  });

  test('a fast response is unaffected by the timer', async () => {
    // Body padded past IMPORT_TEXT_MIN_CHARS: the claim here is that a prompt
    // response logs NOTHING, and a two-character page would now legitimately
    // log a low-yield line and make this assert the wrong thing.
    const pending = fetchUrlAsText('https://example.com/x', {
      fetchImpl: async () => htmlResponse(`<p>${'ok '.repeat(400)}</p>`),
      dnsLookup: publicDns,
      timeoutMs: 20,
    });
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(logged).toEqual([]);
  });
});
