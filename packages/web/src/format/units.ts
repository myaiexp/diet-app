// Canonical dimension → base unit. Must match the API's baseUnit.

import type { Dimension } from '../api/types.js';

/**
 * Display/storage label for a dimension. Same mapping as
 * `packages/api/src/units.ts` `baseUnit` — count is `pieces`, never `pcs`.
 */
export function baseUnit(dimension: Dimension): 'g' | 'ml' | 'pieces' {
  switch (dimension) {
    case 'mass':
      return 'g';
    case 'volume':
      return 'ml';
    case 'count':
      return 'pieces';
  }
}
