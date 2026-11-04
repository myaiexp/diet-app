// Recipes screen servings scaler
//
// Scaling must never be recomputed client-side (the
// fixtures use scaled quantities that deliberately DIFFER from a naive qty*servings/base
// multiply). A failed scale fetch must not leave N-serving chrome over the previous
// quantities; switching recipes mid-fetch must not paint the old recipe's scaled lines.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { flush, jsonResponse } from './harness.js';
import {
  appRouter,
  detailRequests,
  fx,
  makeR1Scaled5,
  makeR1Scaled6,
  mountScreen,
  resetFixtures,
  waitForScaledFetch,
} from './recipes-test-helpers.js';
import type { RecipeWithIngredients } from '../api/types.js';

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  resetFixtures();
  configureClient({ fetch: appRouter() as unknown as typeof fetch });
});

afterEach(() => {
  closeModal();
  resetClient();
});

describe('recipes screen — list and scaler', () => {
  test('shows "base recipe" unchanged, and "scaled ×1.5 from 4" once scaled', async () => {
    const { root } = await mountScreen();
    expect(root.querySelector('.scaler-note')!.textContent).toBe('base recipe');

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    expect(root.querySelector('.scaler-value')!.textContent).toBe('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');
  });

  test('clamps the scaler to the 1..12 range', async () => {
    const { root } = await mountScreen();
    for (let i = 0; i < 5; i += 1) root.querySelector<HTMLElement>('.scaler-minus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('1');

    for (let i = 0; i < 15; i += 1) root.querySelector<HTMLElement>('.scaler-plus')!.click();
    expect(root.querySelector('.scaler-value')!.textContent).toBe('12');
    await waitForScaledFetch('12');
  });

  test('refetches with ?servings=N on scale and renders the API value, not a client-side multiply', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    expect(detailRequests).toContainEqual({ id: 'r1', servings: '6' });
    // Debounced to one extra call, not one per click — would be 2 if the
    // timer were gone (servings=5 then 6).
    expect(detailRequests.filter((r) => r.servings !== undefined)).toHaveLength(1);
    const quantities = [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    // 400*1.5=600 and 20*1.5=30 would be the naive (wrong) client-side answer.
    expect(quantities).toEqual(['605 g', '31 g']);
  });

  test('a failed scale fetch toasts and does not leave 6-serving chrome over 4-serving quantities', async () => {
    fx.scale6 = () => jsonResponse(500, { error: 'cannot scale' });
    const { root } = await mountScreen();
    const baseQuantities = [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    expect(root.querySelector('.scaler-value')!.textContent).toBe('4');
    expect(baseQuantities).toEqual(['400 g', '20 g']);

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/unexpected error/i),
    );
    expect(document.querySelector('.toast')?.className).toContain('toast-error');
    // Chrome and quantities stay aligned on the last successful recipe — not
    // 6-serving chrome over the unscaled 400 g / 20 g lines.
    expect(root.querySelector('.scaler-value')!.textContent).toBe('4');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('base recipe');
    expect([...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent)).toEqual(
      baseQuantities,
    );
  });

  test('an earlier scale response landing after a later one never paints 5-serving lines under 6-serving chrome', async () => {
    let release5!: (value: RecipeWithIngredients) => void;
    fx.scale5 = () =>
      new Promise<RecipeWithIngredients>((resolve) => {
        release5 = resolve;
      });
    const { root } = await mountScreen();

    // Two clicks past the debounce: servings=5 is held in flight, then
    // servings=6 is requested and resolves first.
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('5');
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');
    const quantities = (): Array<string | null> =>
      [...root.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent);
    await vi.waitFor(() => expect(quantities()).toEqual(['605 g', '31 g']));

    release5(makeR1Scaled5());
    await flush(0);
    expect(root.querySelector('.scaler-value')!.textContent).toBe('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');
    expect(quantities()).toEqual(['605 g', '31 g']);
  });

  test('switching recipes while a scale fetch is in flight never paints r1 scaled lines on r2', async () => {
    let release!: (value: RecipeWithIngredients) => void;
    fx.scale6 = () =>
      new Promise<RecipeWithIngredients>((resolve) => {
        release = resolve;
      });
    const { root } = await mountScreen();

    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');

    root.querySelector<HTMLElement>('[data-id="r2"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('h1')?.textContent).toBe('Ohrarisotto'));
    expect(root.querySelectorAll('.ingredient-qty')).toHaveLength(0);

    release(makeR1Scaled6());
    await flush(0);
    const detail = root.querySelector('.panel-pad')!;
    await vi.waitFor(() => expect(detail.querySelector('h1')?.textContent).toBe('Ohrarisotto'));
    // List still names Lohikeitto; the detail pane must not take r1's scaled
    // lines once r2 is selected.
    expect(detail.textContent).not.toContain('605');
    expect(detail.textContent).not.toContain('Salmon');
    expect([...detail.querySelectorAll<HTMLElement>('.ingredient-qty')].map((n) => n.textContent)).toEqual([]);
  });
});
