// Drain helper for paginated list endpoints — one stop condition, one page size.

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { fetchAllPages, PAGE_LIMIT } from '../api/pagination.js';
import { listAllRecipes } from '../api/recipes.js';
import { listAllPantry } from '../api/pantry.js';

import { jsonResponse } from './harness.js';

function ids(n: number, prefix: string): Array<{ id: string }> {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i}` }));
}

describe('fetchAllPages', () => {
  test('returns an empty collection when the first page is empty', async () => {
    const load = vi.fn(async () => []);
    await expect(fetchAllPages(load)).resolves.toEqual([]);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith({ limit: PAGE_LIMIT, offset: 0 });
  });

  test('returns a short first page without a follow-up request', async () => {
    const load = vi.fn(async () => ids(3, 'r'));
    await expect(fetchAllPages(load)).resolves.toEqual(ids(3, 'r'));
    expect(load).toHaveBeenCalledOnce();
  });

  test('drains a full page plus a short remainder', async () => {
    const first = ids(PAGE_LIMIT, 'a');
    const rest = ids(4, 'b');
    const load = vi.fn(async ({ offset }: { offset: number }) =>
      offset === 0 ? first : rest,
    );
    const all = await fetchAllPages(load);
    expect(all).toHaveLength(PAGE_LIMIT + 4);
    expect(all[0]).toEqual({ id: 'a-0' });
    expect(all[PAGE_LIMIT]).toEqual({ id: 'b-0' });
    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenNthCalledWith(2, { limit: PAGE_LIMIT, offset: PAGE_LIMIT });
  });

  test('treats an exact-full page followed by an empty page as complete', async () => {
    const first = ids(PAGE_LIMIT, 'a');
    const load = vi.fn(async ({ offset }: { offset: number }) =>
      offset === 0 ? first : [],
    );
    await expect(fetchAllPages(load)).resolves.toEqual(first);
    expect(load).toHaveBeenCalledTimes(2);
  });

  test('honours a custom page size', async () => {
    const load = vi.fn(async ({ limit, offset }: { limit: number; offset: number }) =>
      offset === 0 ? ids(limit, 'a') : ids(1, 'b'),
    );
    const all = await fetchAllPages(load, 10);
    expect(all).toHaveLength(11);
    expect(load).toHaveBeenNthCalledWith(1, { limit: 10, offset: 0 });
    expect(load).toHaveBeenNthCalledWith(2, { limit: 10, offset: 10 });
  });

  test('propagates an error from a later page', async () => {
    const load = vi.fn(async ({ offset }: { offset: number }) => {
      if (offset === 0) return ids(PAGE_LIMIT, 'a');
      throw new Error('page two failed');
    });
    await expect(fetchAllPages(load)).rejects.toThrow('page two failed');
  });
});

describe('listAllRecipes / listAllPantry', () => {
  let fetchMock: Mock;

  beforeEach(() => {
    fetchMock = vi.fn();
    configureClient({ fetch: fetchMock as unknown as typeof fetch });
  });

  afterEach(() => resetClient());

  test('listAllRecipes walks /recipes at the API max page size and keeps extra query params', async () => {
    const page1 = ids(PAGE_LIMIT, 'r');
    const page2 = ids(2, 'r-tail');
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url, 'http://x');
      expect(u.pathname).toBe('/api/recipes');
      expect(u.searchParams.get('tags')).toBe('fish');
      const offset = Number(u.searchParams.get('offset') ?? 0);
      const limit = Number(u.searchParams.get('limit'));
      expect(limit).toBe(PAGE_LIMIT);
      return jsonResponse(200, offset === 0 ? page1 : page2);
    });

    const all = await listAllRecipes({ tags: 'fish' });
    expect(all).toHaveLength(PAGE_LIMIT + 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('listAllPantry drains /pantry rather than stopping at one page', async () => {
    const page1 = ids(PAGE_LIMIT, 'p');
    const page2 = ids(3, 'p-tail');
    fetchMock.mockImplementation(async (url: string) => {
      const u = new URL(url, 'http://x');
      expect(u.pathname).toBe('/api/pantry');
      const offset = Number(u.searchParams.get('offset') ?? 0);
      return jsonResponse(200, offset === 0 ? page1 : page2);
    });

    const all = await listAllPantry();
    expect(all).toHaveLength(PAGE_LIMIT + 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`limit=${PAGE_LIMIT}`);
  });
});
