// fetchAllPages drain (short-page stop, MAX_PAGES ceiling, API-max default page) and the listAll* helpers built on it.

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import {
  fetchAllPages,
  MAX_PAGES,
  PAGE_LIMIT,
  PaginationLimitError,
} from '../api/pagination.js';
import { userMessage } from '../api/errors.js';
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

  test('rejects after MAX_PAGES full pages instead of looping forever', async () => {
    // A server ignoring `offset` replays the same full page on every request.
    const full = ids(PAGE_LIMIT, 'a');
    const load = vi.fn(async () => full);
    await expect(fetchAllPages(load)).rejects.toBeInstanceOf(PaginationLimitError);
    expect(load).toHaveBeenCalledTimes(MAX_PAGES);
    expect(load).toHaveBeenLastCalledWith({
      limit: PAGE_LIMIT,
      offset: (MAX_PAGES - 1) * PAGE_LIMIT,
    });
  });

  test('a short page on the last allowed request still resolves', async () => {
    const load = vi.fn(async ({ offset }: { offset: number }) =>
      offset === (MAX_PAGES - 1) * 10 ? ids(3, 'z') : ids(10, 'a'),
    );
    await expect(fetchAllPages(load, 10)).resolves.toHaveLength((MAX_PAGES - 1) * 10 + 3);
    expect(load).toHaveBeenCalledTimes(MAX_PAGES);
  });

  test('PAGE_LIMIT is pinned to the API max page size', () => {
    // The API clamps limit; if its cap drops below PAGE_LIMIT every drain
    // reads the first (capped) page as short and silently truncates.
    expect(PAGE_LIMIT, 'must equal MAX_LIMIT in packages/api/src/pagination.ts').toBe(200);
  });

  test('userMessage names the runaway drain rather than blaming the network', () => {
    expect(userMessage(new PaginationLimitError(MAX_PAGES))).toMatch(/more pages/);
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
