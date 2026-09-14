// Drain a paginated list until a short page; default limit is the API max.

export const PAGE_LIMIT = 200;

export interface PageArgs {
  limit: number;
  offset: number;
}

/**
 * Walk `load` until a page shorter than `limit` arrives. The API clamps
 * `limit` at 200 (`getPagination`); requesting more silently gets 200, which
 * reads as a short page and truncates after one fetch — so the default is
 * that ceiling rather than a guess.
 */
export async function fetchAllPages<T>(
  load: (page: PageArgs) => Promise<T[]>,
  limit: number = PAGE_LIMIT,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  for (;;) {
    const page = await load({ limit, offset });
    all.push(...page);
    if (page.length < limit) return all;
    offset += limit;
  }
}
