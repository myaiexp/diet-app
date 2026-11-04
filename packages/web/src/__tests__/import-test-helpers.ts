// Types, form driver and draft fetch router for the recipe import suites

import { vi, expect } from 'vitest';
import { routeFetch } from './harness.js';
import type { makeDraft } from './fixtures.js';

export interface PostedLine {
  ingredientId: string | null;
  quantity: number;
  unit: string;
}
export interface PostedRecipe {
  title: string;
  ingredients: PostedLine[];
}

/** Fills the url field and clicks `extract draft`. */
export function submit(root: HTMLElement, url = 'https://example.com/recipe'): void {
  const input = root.querySelector<HTMLInputElement>('.import-paste input')!;
  input.value = url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('.import-paste .btn-primary')!.click();
}

export async function waitForReview(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(root.querySelector('.import-review')).not.toBeNull());
}

export function draftFetch(
  draft: ReturnType<typeof makeDraft>,
  unmatchedCount = 0,
  extra: Parameters<typeof routeFetch>[0] = {},
) {
  return routeFetch(
    {
      '/api/recipes/import': { draft, unmatchedCount },
      '/api/ingredients': [],
      ...extra,
    },
    { unmatched: '404' },
  );
}
