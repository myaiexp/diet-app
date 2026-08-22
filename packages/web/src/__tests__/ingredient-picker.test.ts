// Shared ingredient search + pick-then-quantity form (pantry add / shopping add).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { el } from '../ui/dom.js';
import { errorBox } from '../ui/form.js';
import {
  attachIngredientSearch,
  createIngredientQuantityForm,
  readQuantityUnit,
} from '../ui/ingredient-picker.js';
import type { Ingredient } from '../api/types.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeIngredient(overrides: Partial<Ingredient> = {}): Ingredient {
  return {
    id: 'ing-1',
    name: 'Potato',
    aliases: ['peruna'],
    category: 'produce',
    defaultUnit: 'kg',
    nutritionPer100g: null,
    shelfLife: null,
    tags: null,
    isPantryStaple: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function pathOf(url: string): string {
  return new URL(url, 'http://x').pathname;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
});

describe('attachIngredientSearch', () => {
  test('debounces, renders name + alias, and calls onPick', async () => {
    const potato = makeIngredient();
    fetchMock.mockResolvedValue(jsonResponse(200, [potato]));

    const input = el('input', { class: 'input', type: 'text' }) as HTMLInputElement;
    const results = el('div', { class: 'pantry-search-results' });
    const onPick = vi.fn();
    attachIngredientSearch(input, results, onPick);

    input.value = 'peruna';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(50);
    expect(fetchMock).not.toHaveBeenCalled();

    await flush(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(pathOf(url)).toBe('/api/ingredients');
    expect(new URL(url, 'http://x').searchParams.get('q')).toBe('peruna');
    expect(new URL(url, 'http://x').searchParams.get('limit')).toBe('8');

    const row = results.querySelector<HTMLButtonElement>('.pantry-search-result')!;
    expect(row.textContent).toContain('Potato');
    expect(row.querySelector('.pantry-alias')?.textContent).toBe('peruna');
    row.click();
    expect(onPick).toHaveBeenCalledWith(potato);
  });

  test('clears results on an empty query and shows no-matches for a miss', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    const input = el('input', { class: 'input', type: 'text' }) as HTMLInputElement;
    const results = el('div');
    attachIngredientSearch(input, results, vi.fn());

    input.value = 'zzzz';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(250);
    expect(results.querySelector('.pantry-search-empty')?.textContent).toMatch(/no matches/i);

    input.value = '   ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(250);
    expect(results.children).toHaveLength(0);
    // Empty needle must not hit the catalog.
    expect(
      fetchMock.mock.calls.filter((c) => {
        const q = new URL(c[0] as string, 'http://x').searchParams.get('q');
        return q === '' || q === '   ';
      }),
    ).toHaveLength(0);
  });

  test('filter option drops already-chosen ingredients from the list', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, [
        makeIngredient({ id: 'ing-1', name: 'Coriander' }),
        makeIngredient({ id: 'ing-2', name: 'Liver', aliases: [] }),
      ]),
    );
    const input = el('input', { class: 'input', type: 'text' }) as HTMLInputElement;
    const results = el('div');
    attachIngredientSearch(input, results, vi.fn(), { filter: (ing) => ing.id !== 'ing-1' });

    input.value = 'i';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(250);

    const names = [...results.querySelectorAll('.pantry-search-result')].map((n) => n.textContent);
    expect(names).toEqual(['Liver']);
  });
});

describe('readQuantityUnit', () => {
  test('rejects non-positive quantity and a blank unit, then returns the pair', () => {
    const qty = el('input', { type: 'number', value: '0' }) as HTMLInputElement;
    const unit = el('input', { type: 'text', value: 'g' }) as HTMLInputElement;
    const err = errorBox();

    expect(readQuantityUnit(qty, unit, err)).toBeNull();
    expect(err.textContent).toMatch(/positive number/i);

    qty.value = '2';
    unit.value = '  ';
    expect(readQuantityUnit(qty, unit, err)).toBeNull();
    expect(err.textContent).toMatch(/Unit is required/);

    unit.value = 'kg';
    expect(readQuantityUnit(qty, unit, err)).toEqual({ quantity: 2, unit: 'kg' });
  });
});

describe('createIngredientQuantityForm', () => {
  test('pick swaps to detail, prefills defaultUnit, and labels with the alias', () => {
    const extra = el('div', { class: 'extra-slot' }, 'note');
    const form = createIngredientQuantityForm({ extraFields: [extra] });
    document.body.append(form.body);

    expect(form.pickStep.classList.contains('hidden')).toBe(false);
    expect(form.detailStep.classList.contains('hidden')).toBe(true);
    expect(form.body.querySelector('input[type="text"]')?.getAttribute('placeholder')).toMatch(
      /peruna/i,
    );

    form.selectIngredient(makeIngredient());
    expect(form.pickStep.classList.contains('hidden')).toBe(true);
    expect(form.detailStep.classList.contains('hidden')).toBe(false);
    expect(form.unitInput.value).toBe('kg');
    expect(form.detailStep.querySelector('.pantry-chosen')?.textContent).toBe('Potato · peruna');

    const kids = [...form.detailStep.children];
    expect(kids.at(-2)).toBe(extra);
    expect(kids.at(-1)?.classList.contains('helper-error')).toBe(true);
  });

  test('read() requires a pick, then quantity and unit, then returns the parsed row', () => {
    const form = createIngredientQuantityForm();
    document.body.append(form.body);

    expect(form.read()).toBeNull();
    expect(form.err.textContent).toMatch(/Pick an ingredient first/i);

    const ing = makeIngredient({ aliases: [] });
    form.selectIngredient(ing);
    expect(form.detailStep.querySelector('.pantry-chosen')?.textContent).toBe('Potato');
    expect(form.err.classList.contains('hidden')).toBe(true);

    form.qtyInput.value = '0';
    expect(form.read()).toBeNull();
    expect(form.err.textContent).toMatch(/positive number/i);

    form.qtyInput.value = '1.5';
    form.unitInput.value = '';
    expect(form.read()).toBeNull();
    expect(form.err.textContent).toMatch(/Unit is required/);

    form.unitInput.value = 'kg';
    expect(form.read()).toEqual({ ingredient: ing, quantity: 1.5, unit: 'kg' });
  });
});
