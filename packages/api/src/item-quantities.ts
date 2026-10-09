// Reconcile a shopping-item quantity edit so needed, coverage and net stay consistent.

import { round6 } from './units.js';

export interface ItemQuantityState {
  source: string;
  quantityNeeded: string;
  quantityInPantry: string;
  netToBuy: string;
}

export interface ItemQuantityInput {
  quantityNeeded?: number;
  netToBuy?: number;
}

export interface ItemQuantityWrite {
  quantityNeeded: string;
  quantityInPantry: string;
  netToBuy: string;
  /** True only when a number the client sent actually moved. Regeneration reads this. */
  quantityEdited: boolean;
}

export type ItemQuantityResult =
  | { ok: true; write: ItemQuantityWrite | null }
  | { ok: false; error: string };

const INCONSISTENT = 'quantityNeeded and netToBuy are inconsistent';
const NOT_POSITIVE = 'quantityNeeded must stay positive';

/** Stored numeric, clamped. A missing or garbage value counts as zero coverage, never NaN. */
function stored(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return round6(Math.max(0, n));
}

function same(a: number, b: number): boolean {
  return round6(a) === round6(b);
}

// Integer micro-units so needed − pantry = net exactly. Float subtraction of two
// already-rounded quantities is not that identity (0.3 − 0.1 !== 0.2).
function micro(n: number): number {
  return Math.round(n * 1e6);
}

function fromMicro(m: number): number {
  return m / 1e6;
}

/**
 * The write that keeps one item's quantity triple consistent, or null when the
 * patch does not mention a quantity.
 *
 * Generated: net = needed − coverage, and coverage is capped at needed — the
 * same identity generation stores. Manual: the user typed what to buy, so
 * needed and net stay equal and coverage stays 0.
 *
 * `quantityEdited` is set only when a number the client sent differs from the
 * stored one. Reaffirming the current demand still heals a stale net (that is
 * what /complete would file) but does not lock the row against regeneration.
 */
export function reconcileItemQuantities(
  existing: ItemQuantityState,
  patch: ItemQuantityInput,
): ItemQuantityResult {
  const neededSent = patch.quantityNeeded !== undefined;
  const netSent = patch.netToBuy !== undefined;
  if (!neededSent && !netSent) return { ok: true, write: null };

  const manual = existing.source === 'manual';
  const coverage = stored(existing.quantityInPantry);
  const storedNeeded = stored(existing.quantityNeeded);
  const storedNet = stored(existing.netToBuy);

  let neededMicro: number;
  let pantryMicro: number;
  let netMicro: number;

  if (manual) {
    if (neededSent && netSent && !same(patch.quantityNeeded!, patch.netToBuy!)) {
      return { ok: false, error: INCONSISTENT };
    }
    const value = round6(neededSent ? patch.quantityNeeded! : patch.netToBuy!);
    // 0 would make the two equal and the row need nothing. quantityNeeded is
    // positive everywhere else; a manual "buy nothing" is not a row.
    if (!(value > 0)) return { ok: false, error: NOT_POSITIVE };
    const units = micro(value);
    neededMicro = units;
    pantryMicro = 0;
    netMicro = units;
  } else if (neededSent) {
    const needed = round6(patch.quantityNeeded!);
    if (!(needed > 0)) return { ok: false, error: NOT_POSITIVE };
    neededMicro = micro(needed);
    pantryMicro = Math.min(micro(coverage), neededMicro);
    netMicro = neededMicro - pantryMicro;
    if (netSent && !same(patch.netToBuy!, fromMicro(netMicro))) {
      return { ok: false, error: INCONSISTENT };
    }
  } else {
    const net = round6(patch.netToBuy!);
    if (!(net >= 0)) return { ok: false, error: NOT_POSITIVE };
    // "Buy this much" plus what the pantry already covers is the demand.
    // Coverage above that demand cannot happen: net ≥ 0, so needed ≥ coverage.
    netMicro = micro(net);
    pantryMicro = micro(coverage);
    neededMicro = netMicro + pantryMicro;
    if (!(neededMicro > 0)) return { ok: false, error: NOT_POSITIVE };
  }

  const userMoved =
    (neededSent && !same(patch.quantityNeeded!, storedNeeded)) ||
    (netSent && !same(patch.netToBuy!, storedNet));

  return {
    ok: true,
    write: {
      quantityNeeded: String(fromMicro(neededMicro)),
      quantityInPantry: String(fromMicro(pantryMicro)),
      netToBuy: String(fromMicro(netMicro)),
      quantityEdited: userMoved,
    },
  };
}
