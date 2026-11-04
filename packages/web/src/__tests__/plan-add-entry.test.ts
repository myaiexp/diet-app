// Meal plan add-entry: the picker, recipe-backed and freeform entries

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { planScreen } from '../screens/plan/index.js';
import { makeCtx, mountRoot, pathOf } from './harness.js';
import { makeRecipe } from './fixtures.js';
import { buildRouter, MONDAY } from './plan-test-helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;

function postCalls() {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      pathOf(String(url)) === '/api/meal-plans' && ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
  );
}

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe('add-entry affordance', () => {
  test('an empty cell opens the add-entry affordance and does not navigate', async () => {
    fetchMock.mockImplementation(buildRouter());
    const root = mountRoot();
    const ctx = makeCtx();
    await planScreen().mount(root, ctx);

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.add-entry-picker')).not.toBeNull();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  test('creates a recipe-backed entry from the picker', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [makeRecipe({ id: 'r1', title: 'Lohikeitto' })] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-recipe-row')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-recipe-row[data-id="r1"]')!.click();
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['recipeId']).toBe('r1');
    expect('freeformNote' in body).toBe(false);
    expect(body['slot']).toBe('breakfast');
    expect(body['date']).toBe(MONDAY);
  });

  test('creates a freeform-note entry with no recipe', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    const noteInput = document.querySelector<HTMLInputElement>('.add-entry-note')!;
    noteInput.value = 'Työlounas — canteen';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    await vi.waitFor(() => expect(postCalls()).toHaveLength(1));
    const [, init] = postCalls()[0]!;
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body['freeformNote']).toBe('Työlounas — canteen');
    expect('recipeId' in body).toBe(false);
  });

  test('rejects an add with neither a recipe nor a note before sending', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() => expect(document.querySelector('.add-entry-picker')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.add-entry-save')!.click();

    expect(postCalls()).toHaveLength(0);
    const err = document.querySelector('.helper-error');
    expect(err?.classList.contains('hidden')).toBe(false);
    expect(err?.textContent).toMatch(/recipe|note/i);
  });

  test('works with an empty recipe collection (freeform-only first run)', async () => {
    fetchMock.mockImplementation(buildRouter({ recipes: [] }));
    const root = mountRoot();
    await planScreen().mount(root, makeCtx());

    root.querySelector<HTMLButtonElement>('.plan-cell-empty')!.click();
    await vi.waitFor(() =>
      expect(document.querySelector('.add-entry-recipe-empty')?.textContent).toMatch(/no recipes yet/i),
    );
  });
});
