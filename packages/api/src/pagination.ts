// Parse + clamp ?limit / ?offset pagination params for list endpoints.

import type { Context } from 'hono';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface Pagination {
  limit: number;
  offset: number;
}

// Read ?limit / ?offset off the request, falling back to defaults and clamping
// to safe bounds. A missing, empty, non-numeric, or non-integer value falls back
// to the default; limit is clamped to [1, MAX_LIMIT] and offset to [0, ∞).
export function getPagination(c: Context): Pagination {
  return {
    limit: clampInt(c.req.query('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(c.req.query('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
