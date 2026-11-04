// Recipes screen: list, filters, source labels and pantry-labelled lines

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import {
  appRouter,
  mountScreen,
  resetFixtures,
  pantryRequestCount,
  recipeRequests,
  recipesById,
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

describe('recipes screen — list and scaler', () => {
  test('shows a dedicated empty state pointing at import when the collection is empty', async () => {
    recipesById.clear();
    const { root, ctx } = await mountScreen();
    expect(root.querySelector('.empty-state')).not.toBeNull();
    root.querySelector<HTMLElement>('.btn-primary')!.click();
    expect(ctx.navigate).toHaveBeenCalledWith('/import');
  });

  test('sets the subtitle with the real collection count', async () => {
    const { ctx } = await mountScreen();
    expect(ctx.setSubtitle).toHaveBeenCalledWith('4 in collection · filter by tag');
  });

  test('tints the source-type label by kind', async () => {
    const { root } = await mountScreen();
    // r1 (manual) is auto-selected — no color suffix.
    const manualLabel = root.querySelector<HTMLElement>('.source-label')!;
    expect(manualLabel.classList.contains('label')).toBe(true);
    expect(manualLabel.classList.contains('label-blue')).toBe(false);

    root.querySelector<HTMLElement>('[data-id="r2"]')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-blue')).toBe(true),
    );

    root.querySelector<HTMLElement>('[data-id="r3"]')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-purple')).toBe(true),
    );

    root.querySelector<HTMLElement>('[data-id="r4"]')!.click();
    await vi.waitFor(() =>
      expect(root.querySelector('.source-label')!.classList.contains('label-cyan')).toBe(true),
    );
  });

  test('sends multiple selected tags as one comma-joined ?tags= value', async () => {
    const { root } = await mountScreen();
    root.querySelector<HTMLElement>('[data-tag="quick"]')!.click();
    await vi.waitFor(() => expect(recipeRequests.some((r) => r.tags === 'quick')).toBe(true));
    root.querySelector<HTMLElement>('[data-tag="fish"]')!.click();
    await vi.waitFor(() => expect(recipeRequests.at(-1)?.tags).toBe('quick,fish'));
  });

  test('labels each ingredient line from the pantry list without refetching it per line', async () => {
    const { root } = await mountScreen();
    const labels = [...root.querySelectorAll<HTMLElement>('.ingredient-line')].map((line) => {
      const badge = line.lastElementChild as HTMLElement;
      return { text: badge.textContent, cls: badge.className };
    });
    expect(labels[0]!.text).toBe('in pantry');
    expect(labels[0]!.cls).toContain('label-green');
    expect(labels[1]!.text).toBe('to buy');
    expect(labels[1]!.cls).toContain('label-tobuy');
    expect(pantryRequestCount).toBe(1);
  });
});
