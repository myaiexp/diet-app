// Drain a paginated list until a short page; default limit is the API max.

export const PAGE_LIMIT = 200;

/**
 * Hard ceiling on requests per drain: 50 × 200 = 10,000 rows, far past any
 * real collection here. A server that ignores `offset` (a proxy replaying one
 * response, a route that drops the offset binding) returns a full page
 * forever; without this the tab would fetch and accumulate until it dies.
 */
export const MAX_PAGES = 50;

export class PaginationLimitError extends Error {
  constructor(readonly pages: number) {
    super(`Pagination did not terminate after ${pages} full pages`);
    this.name = 'PaginationLimitError';
  }
}

export interface PageArgs {
  limit: number;
  offset: number;
}

/**
 * Walk `load` until a page shorter than `limit` arrives. The API clamps
 * `limit` at 200 (`getPagination`); requesting more silently gets 200, which
 * reads as a short page and truncates after one fetch — so the default is
 * that ceiling rather than a guess. Throws `PaginationLimitError` once
 * `MAX_PAGES` full pages have arrived without a short one.
 */
export async function fetchAllPages<T>(
  load: (page: PageArgs) => Promise<T[]>,
  limit: number = PAGE_LIMIT,
): Promise<T[]> {
  const all: T[] = [];
  for (let pages = 0; pages < MAX_PAGES; pages++) {
    const page = await load({ limit, offset: pages * limit });
    all.push(...page);
    if (page.length < limit) return all;
  }
  throw new PaginationLimitError(MAX_PAGES);
}
