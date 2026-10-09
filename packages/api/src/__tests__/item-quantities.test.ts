// The quantity invariant: generated rows recompute net, manual rows stay equal.

import { describe, expect, test } from 'vitest';
import { round6 } from '../units.js';
import {
  reconcileItemQuantities,
  type ItemQuantityState,
} from '../item-quantities.js';

function row(overrides: Partial<ItemQuantityState> = {}): ItemQuantityState {
  return {
    source: 'generated',
    quantityNeeded: '400',
    quantityInPantry: '100',
    netToBuy: '300',
    ...overrides,
  };
}

function nums(write: { quantityNeeded: string; quantityInPantry: string; netToBuy: string }) {
  return {
    needed: Number(write.quantityNeeded),
    pantry: Number(write.quantityInPantry),
    net: Number(write.netToBuy),
  };
}

/** net = needed − pantry, pantry capped at needed, both sides nonnegative. */
function expectConsistent(
  source: string,
  write: { quantityNeeded: string; quantityInPantry: string; netToBuy: string },
) {
  const { needed, pantry, net } = nums(write);
  expect(needed).toBeGreaterThan(0);
  expect(pantry).toBeGreaterThanOrEqual(0);
  expect(net).toBeGreaterThanOrEqual(0);
  expect(pantry).toBeLessThanOrEqual(needed);
  expect(net).toBe(round6(needed - pantry));
  if (source === 'manual') {
    expect(pantry).toBe(0);
    expect(net).toBe(needed);
  }
}

describe('reconcileItemQuantities', () => {
  test('leaves a patch that does not touch quantities alone', () => {
    expect(reconcileItemQuantities(row(), {})).toEqual({ ok: true, write: null });
  });

  // Finding #11788: PATCH { quantityNeeded: 2000 } on a generated row whose
  // net is still the old figure must recompute net, not leave it stale.
  test('recomputes netToBuy when quantityNeeded changes on a generated row', () => {
    const result = reconcileItemQuantities(
      row({ quantityNeeded: '1000', quantityInPantry: '0', netToBuy: '1000' }),
      { quantityNeeded: 2000 },
    );
    expect(result).toEqual({
      ok: true,
      write: {
        quantityNeeded: '2000',
        quantityInPantry: '0',
        netToBuy: '2000',
        quantityEdited: true,
      },
    });
  });

  test('caps pantry coverage at the new demand so the subtraction still holds', () => {
    const result = reconcileItemQuantities(row(), { quantityNeeded: 50 });
    expect(result).toEqual({
      ok: true,
      write: {
        quantityNeeded: '50',
        quantityInPantry: '50',
        netToBuy: '0',
        quantityEdited: true,
      },
    });
  });

  test('heals a stale net when quantityNeeded is reaffirmed, without locking the row', () => {
    // The demand did not move, so regeneration may still refresh this row.
    // The net must not stay at the stale 100 — that is what /complete would file.
    const result = reconcileItemQuantities(row({ netToBuy: '100' }), { quantityNeeded: 400 });
    expect(result).toEqual({
      ok: true,
      write: {
        quantityNeeded: '400',
        quantityInPantry: '100',
        netToBuy: '300',
        quantityEdited: false,
      },
    });
  });

  test('derives demand from a netToBuy-only edit on a generated row', () => {
    const result = reconcileItemQuantities(row(), { netToBuy: 50 });
    expect(result).toEqual({
      ok: true,
      write: {
        quantityNeeded: '150',
        quantityInPantry: '100',
        netToBuy: '50',
        quantityEdited: true,
      },
    });
  });

  test('accepts a generated pair that already matches the formula', () => {
    const result = reconcileItemQuantities(row(), { quantityNeeded: 2000, netToBuy: 1900 });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.write) throw new Error('expected a write');
    expectConsistent('generated', result.write);
    expect(result.write.quantityEdited).toBe(true);
    expect(result.write.netToBuy).toBe('1900');
  });

  test('rejects a generated pair that would store a stale net', () => {
    const result = reconcileItemQuantities(row(), { quantityNeeded: 2000, netToBuy: 300 });
    expect(result).toEqual({ ok: false, error: 'quantityNeeded and netToBuy are inconsistent' });
  });

  test('rejects a netToBuy of 0 that would leave a generated row needing nothing', () => {
    const result = reconcileItemQuantities(
      row({ quantityNeeded: '400', quantityInPantry: '0', netToBuy: '400' }),
      { netToBuy: 0 },
    );
    expect(result).toEqual({ ok: false, error: 'quantityNeeded must stay positive' });
  });

  test('keeps a manual row\'s quantityNeeded and netToBuy equal', () => {
    const needed = reconcileItemQuantities(
      row({ source: 'manual', quantityNeeded: '500', quantityInPantry: '0', netToBuy: '500' }),
      { quantityNeeded: 2000 },
    );
    expect(needed).toEqual({
      ok: true,
      write: {
        quantityNeeded: '2000',
        quantityInPantry: '0',
        netToBuy: '2000',
        quantityEdited: true,
      },
    });

    const net = reconcileItemQuantities(
      row({ source: 'manual', quantityNeeded: '500', quantityInPantry: '0', netToBuy: '500' }),
      { netToBuy: 3 },
    );
    expect(net).toEqual({
      ok: true,
      write: {
        quantityNeeded: '3',
        quantityInPantry: '0',
        netToBuy: '3',
        quantityEdited: true,
      },
    });
  });

  test('forces a manual row back to equal even when pantry coverage was nonzero', () => {
    const result = reconcileItemQuantities(
      row({ source: 'manual', quantityNeeded: '500', quantityInPantry: '80', netToBuy: '500' }),
      { quantityNeeded: 20 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.write) throw new Error('expected a write');
    expectConsistent('manual', result.write);
    expect(result.write.quantityNeeded).toBe('20');
    expect(result.write.netToBuy).toBe('20');
  });

  test('rejects a manual pair that is not equal', () => {
    const result = reconcileItemQuantities(
      row({ source: 'manual', quantityNeeded: '500', quantityInPantry: '0', netToBuy: '500' }),
      { quantityNeeded: 10, netToBuy: 4 },
    );
    expect(result).toEqual({ ok: false, error: 'quantityNeeded and netToBuy are inconsistent' });
  });

  test('rejects a manual netToBuy of 0', () => {
    const result = reconcileItemQuantities(
      row({ source: 'manual', quantityNeeded: '500', quantityInPantry: '0', netToBuy: '500' }),
      { netToBuy: 0 },
    );
    expect(result).toEqual({ ok: false, error: 'quantityNeeded must stay positive' });
  });

  // Rule, not one example: any positive demand and any nonnegative coverage
  // comes back satisfying net = needed − pantry (manual: the two are equal
  // and coverage is 0). A lock is taken only when a sent number actually moves.
  test('holds for any demand, coverage and source', () => {
    let seed = 0x11788;
    const next = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const sources = ['generated', 'manual'] as const;

    for (let i = 0; i < 200; i++) {
      const source = sources[i % 2]!;
      const coverage = round6(next() * 5000);
      const storedNeeded = round6(next() * 4000 + 0.000001);
      const storedNet = round6(Math.max(0, storedNeeded - Math.min(coverage, storedNeeded)));
      const existing = row({
        source,
        quantityNeeded: String(storedNeeded),
        quantityInPantry: String(source === 'manual' && i % 5 === 0 ? round6(next() * 100) : coverage),
        netToBuy: String(storedNet),
      });

      const sentNeeded = round6(next() * 4000 + 0.000001);
      const byNeeded = reconcileItemQuantities(existing, { quantityNeeded: sentNeeded });
      expect(byNeeded.ok, `needed-only ${i}`).toBe(true);
      if (!byNeeded.ok) continue;
      expect(byNeeded.write, `needed-only ${i} must write`).not.toBeNull();
      if (!byNeeded.write) continue;
      expectConsistent(source, byNeeded.write);
      expect(byNeeded.write.quantityNeeded).toBe(String(sentNeeded));
      expect(byNeeded.write.quantityEdited).toBe(sentNeeded !== storedNeeded);

      if (source === 'generated') {
        const sentNet = round6(next() * 2000);
        const byNet = reconcileItemQuantities(existing, { netToBuy: sentNet });
        if (sentNet + coverage <= 0) {
          expect(byNet.ok, `net-only zero ${i}`).toBe(false);
        } else {
          expect(byNet.ok, `net-only ${i}`).toBe(true);
          if (!byNet.ok) continue;
          expect(byNet.write, `net-only ${i} must write`).not.toBeNull();
          if (!byNet.write) continue;
          expectConsistent('generated', byNet.write);
          expect(Number(byNet.write.netToBuy)).toBe(sentNet);
          expect(byNet.write.quantityEdited).toBe(sentNet !== storedNet);
        }

        const matchingNet = Number(byNeeded.write.netToBuy);
        const agreed = reconcileItemQuantities(existing, {
          quantityNeeded: sentNeeded,
          netToBuy: matchingNet,
        });
        expect(agreed.ok, `agreeing pair ${i}`).toBe(true);
        if (!agreed.ok) continue;
        expect(agreed.write, `agreeing pair ${i} must write`).not.toBeNull();
        if (!agreed.write) continue;
        expectConsistent('generated', agreed.write);

        const staleNet = round6(matchingNet + 1);
        const disagreed = reconcileItemQuantities(existing, {
          quantityNeeded: sentNeeded,
          netToBuy: staleNet,
        });
        expect(disagreed, `disagreeing pair ${i}`).toEqual({
          ok: false,
          error: 'quantityNeeded and netToBuy are inconsistent',
        });
      } else {
        const agreed = reconcileItemQuantities(existing, {
          quantityNeeded: sentNeeded,
          netToBuy: sentNeeded,
        });
        expect(agreed.ok, `manual agreeing pair ${i}`).toBe(true);
        const disagreed = reconcileItemQuantities(existing, {
          quantityNeeded: sentNeeded,
          netToBuy: round6(sentNeeded + 1),
        });
        expect(disagreed.ok, `manual disagreeing pair ${i}`).toBe(false);
      }
    }
  });
});
