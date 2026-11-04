// Recipes screen fork and edit flows
//
// Editing must always read from an unscaled recipe, even when the scaler is
// showing a scaled view — see the dedicated test for that.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import {
  appRouter,
  mountScreen,
  resetFixtures,
  patchRequests,
  postRequests,
  waitForScaledFetch,
} from './recipes-test-helpers.js';

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

describe('recipes screen — fork and edit', () => {
  test('forks a recipe into a new one carrying parentRecipeId and sourceType "forked"', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.fork-btn')!.click();
    await vi.waitFor(() => expect(postRequests).toHaveLength(1));
    expect(postRequests[0]!['parentRecipeId']).toBe('r1');
    expect(postRequests[0]!['sourceType']).toBe('forked');
  });

  test('an edit resends the full ingredient list, not just the changed line', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.edit-qty-input')).toHaveLength(2),
    );

    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    qtyInputs[0]!.value = '999';

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await vi.waitFor(() => expect(patchRequests).toHaveLength(1));
    const sent = patchRequests[0]!.body.recipeIngredients;
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ ingredientId: 'ing-salmon', quantity: '999' });
    expect(sent[1]).toMatchObject({ ingredientId: 'ing-dill', quantity: '20' });
  });

  test('an edit made while scaled to ×1.5 reads and persists unscaled quantities', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    root.querySelector<HTMLElement>('.scaler-plus')!.click();
    await waitForScaledFetch('6');
    expect(root.querySelector('.scaler-note')!.textContent).toBe('scaled ×1.5 from 4');

    root.querySelector<HTMLElement>('.edit-btn')!.click();
    await vi.waitFor(() =>
      expect(document.querySelectorAll('.edit-qty-input')).toHaveLength(2),
    );

    // The edit form must show the true base quantities (400/20), not 605/31.
    const qtyInputs = document.querySelectorAll<HTMLInputElement>('.edit-qty-input');
    expect(qtyInputs[0]!.value).toBe('400');
    expect(qtyInputs[1]!.value).toBe('20');

    document.querySelector<HTMLElement>('.modal-foot .btn-primary')!.click();
    await vi.waitFor(() => expect(patchRequests.length).toBeGreaterThan(0));

    const sent = patchRequests[patchRequests.length - 1]!.body.recipeIngredients;
    expect(sent[0]).toMatchObject({ quantity: '400' });
    expect(sent[1]).toMatchObject({ quantity: '20' });
  });
});
