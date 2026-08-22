// API client + error mapping

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import {
  apiGet,
  apiSend,
  configureClient,
  resetClient,
  REQUEST_TIMEOUT_MS,
} from '../api/client.js';
import { ApiError, userMessage, fieldErrors } from '../api/errors.js';
import { extractDraft, IMPORT_TIMEOUT_MS } from '../api/recipe-import.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: Mock;
let expired: Mock<() => void>;

beforeEach(() => {
  fetchMock = vi.fn();
  expired = vi.fn(() => {});
  configureClient({ fetch: fetchMock as unknown as typeof fetch, onSessionExpired: expired });
});

afterEach(() => resetClient());

describe('apiGet', () => {
  test('calls the same-origin /api base with encoded params', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: 'a' }]));
    const rows = await apiGet<Array<{ id: string }>>('/pantry', { limit: 50, q: 'peruna & co' });
    expect(rows).toEqual([{ id: 'a' }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/pantry?limit=50&q=peruna+%26+co');
    expect(init.method).toBe('GET');
  });

  test('sends no Authorization header — nginx injects it', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await apiGet('/pantry');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toContain('authorization');
  });

  test('drops undefined params rather than sending the string "undefined"', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await apiGet('/recipes', { tags: undefined, limit: 50 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/recipes?limit=50');
  });

  test('throws ApiError carrying the status and body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Not found' }));
    await expect(apiGet('/pantry/x')).rejects.toMatchObject({
      status: 404,
      body: { error: 'Not found' },
    });
  });

  test('reloads the page on 401 rather than surfacing an error to the screen', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Unauthorized' }));
    // 401 means the central-hub session expired mid-session; a reload hits the
    // edge gate, which redirects to login.
    await expect(apiGet('/pantry')).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
  });

  test('passes AbortSignal.timeout at the default request bound', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await apiGet('/pantry');
    expect(spy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    spy.mockRestore();
  });
});

describe('apiSend', () => {
  test('POSTs a JSON body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'new' }));
    const created = await apiSend('POST', '/pantry', { quantity: 400 });
    expect(created).toEqual({ id: 'new' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/pantry');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ quantity: 400 });
  });

  test('handles a 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiSend('DELETE', '/pantry/x')).resolves.toBeUndefined();
  });

  test('keeps a non-JSON error body readable', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', { status: 502 }),
    );
    await expect(apiSend('POST', '/recipes/import', {})).rejects.toMatchObject({
      status: 502,
    });
  });

  test('honours a per-call timeout override', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { id: 'new' }));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await apiSend('POST', '/pantry', { quantity: 1 }, { timeoutMs: 12_000 });
    expect(spy).toHaveBeenCalledWith(12_000);
    spy.mockRestore();
  });
});

describe('request timeout', () => {
  test('rejects a hung fetch once the bound fires', async () => {
    configureClient({ timeoutMs: 40 });
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    });
    await expect(apiGet('/pantry')).rejects.toMatchObject({ name: /^(TimeoutError|AbortError)$/ });
  });

  test('extractDraft uses the longer import bound, not the default', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { title: 'Soup', ingredients: [] }));
    const spy = vi.spyOn(AbortSignal, 'timeout');
    await extractDraft({ text: 'soup' });
    expect(spy).toHaveBeenCalledWith(IMPORT_TIMEOUT_MS);
    expect(IMPORT_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    spy.mockRestore();
  });
});

describe('userMessage', () => {
  test('maps a 404 body to its error string', () => {
    expect(userMessage(new ApiError(404, { error: 'Not found' }))).toBe('Not found');
  });

  test('maps 503 to the AI-unavailable message', () => {
    expect(userMessage(new ApiError(503, { error: 'AI not configured' }))).toBe(
      'AI import is not configured on the server.',
    );
  });

  test('maps 502 to a retryable failure that says nothing was saved', () => {
    const msg = userMessage(new ApiError(502, { error: 'Recipe extraction failed' }));
    expect(msg).toContain('Recipe extraction failed');
    expect(msg).toContain('nothing was saved');
  });

  test('maps a network failure to a generic retryable message', () => {
    expect(userMessage(new TypeError('Failed to fetch'))).toMatch(/never reached the server/);
  });

  test('maps a timeout abort to a retryable timeout message, not the offline copy', () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError');
    const aborted = new DOMException('The operation was aborted.', 'AbortError');
    expect(userMessage(timeout)).toMatch(/timed out/);
    expect(userMessage(timeout)).not.toMatch(/never reached the server/);
    expect(userMessage(aborted)).toMatch(/timed out/);
  });

  test('extracts Zod form errors from a 400 details payload', () => {
    const err = new ApiError(400, {
      error: 'Validation failed',
      details: { formErrors: ['Either recipeId or freeformNote is required'] },
    });
    expect(fieldErrors(err)).toEqual(['Either recipeId or freeformNote is required']);
  });
});
