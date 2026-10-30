// What a pantry PATCH that changes only the unit does to the stored quantity

import { LIMITS } from './schemas/fields.js';
import { fromBase, resolveUnit, round6, toBase } from './units.js';

export type UnitChange =
  | { kind: 'none' }
  | { kind: 'rescaled'; quantity: number }
  | { kind: 'refused'; error: string };

/**
 * A unit rename must keep the amount: `2 kg` renamed to `g` is 2000 g, never 2 g.
 * A patch that also sends `quantity` states the amount itself, so it is taken
 * literally — that is how a row recorded in the wrong dimension gets corrected,
 * since no factor crosses mass, volume and count.
 */
export function planUnitChange(
  stored: { quantity: string; unit: string },
  patch: { quantity?: number; unit?: string },
): UnitChange {
  if (patch.unit === undefined || patch.quantity !== undefined) return { kind: 'none' };

  const based = toBase(Number(stored.quantity), stored.unit);
  const target = resolveUnit(patch.unit);
  if (!based || !target || based.dimension !== target.dimension) {
    return {
      kind: 'refused',
      error: `Cannot convert ${stored.unit} to ${patch.unit} — change the quantity too`,
    };
  }

  // fromBase cannot be null: resolveUnit accepted this same unit above.
  const quantity = round6(fromBase(based.value, patch.unit)!);
  if (quantity <= 0 || quantity > LIMITS.quantity) {
    return {
      kind: 'refused',
      error: `${stored.quantity} ${stored.unit} does not fit in ${patch.unit} — change the quantity too`,
    };
  }
  return { kind: 'rescaled', quantity };
}
