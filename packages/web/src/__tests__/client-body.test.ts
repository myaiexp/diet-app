// API client response-body handling: non-JSON bodies on error and success statuses

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { apiGet, apiSend, configureClient, resetClient } from '../api/client.js';
import { ApiError, UnexpectedBodyError, userMessage } from '../api/errors.js';

let fetchMock: Mock;

beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch, onSessionExpired: () => {} });
});

afterEach(() => resetClient());

function htmlResponse(status: number, html: string): Response {
  return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

describe('non-JSON response bodies', () => {
  test('a non-JSON error body stays readable as the ApiError message', async () => {
    fetchMock.mockResolvedValue(htmlResponse(502, '<html>502 Bad Gateway</html>'));
    const err = await apiSend('POST', '/recipes/import', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(502);
    expect((err as ApiError).body?.error).toContain('502 Bad Gateway');
    expect(userMessage(err)).toContain('502 Bad Gateway');
  });

  test('a long non-JSON error body is cut to 200 characters', async () => {
    fetchMock.mockResolvedValue(htmlResponse(500, 'x'.repeat(5000)));
    const err = await apiGet('/pantry').catch((e: unknown) => e);
    expect((err as ApiError).body?.error).toHaveLength(200);
  });

  test('a 200 HTML page (SPA fallback, misrouted proxy) rejects instead of resolving as data', async () => {
    fetchMock.mockResolvedValue(htmlResponse(200, '<!doctype html><html><body>app</body></html>'));
    const err = await apiGet('/pantry').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnexpectedBodyError);
    // Not an ApiError: nothing that branches on API status codes may treat
    // this as an answer from the API.
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as UnexpectedBodyError).status).toBe(200);
    expect(userMessage(err)).toMatch(/web page instead of data/);
  });

  test('a 201 non-JSON body on a write rejects too', async () => {
    fetchMock.mockResolvedValue(htmlResponse(201, 'created'));
    await expect(apiSend('POST', '/pantry', { quantity: 1 })).rejects.toBeInstanceOf(
      UnexpectedBodyError,
    );
  });

  test('a 200 with an empty body still resolves to null', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    await expect(apiGet('/pantry')).resolves.toBeNull();
  });
});
