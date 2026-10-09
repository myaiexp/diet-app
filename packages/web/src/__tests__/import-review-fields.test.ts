// Import review: edits to the draft header are what POST /recipes sends.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { jsonResponse, makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeDraft, makeLine } from './fixtures.js';

function submit(root: HTMLElement): void {
  const input = root.querySelector<HTMLInputElement>('.import-paste input')!;
  input.value = 'https://example.com/recipe';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  root.querySelector<HTMLButtonElement>('.import-paste .btn-primary')!.click();
}

function fieldControl(root: HTMLElement, label: string): HTMLInputElement | HTMLTextAreaElement {
  const found = [...root.querySelectorAll<HTMLElement>('.import-field')].find((el) =>
    (el.childNodes[0]?.textContent ?? '').startsWith(label),
  );
  if (!found) throw new Error(`field not found: ${label}`);
  const control = found.querySelector('input, textarea');
  if (!control) throw new Error(`control not found: ${label}`);
  return control as HTMLInputElement;
}

function setField(root: HTMLElement, label: string, value: string): void {
  const control = fieldControl(root, label);
  control.value = value;
  control.dispatchEvent(new Event('change', { bubbles: true }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => resetClient());

describe('import review header edits', () => {
  test('posts the corrected title, prep and steps, and keeps servings when the field is cleared', async () => {
    const draft = makeDraft({
      title: 'Old title',
      servings: 4,
      prepTime: null,
      steps: ['Step one', 'Step two'],
      ingredients: [
        makeLine({ rawName: 'bound', ingredientId: 'ing-1', quantity: 100, unit: 'g', match: 'exact' }),
      ],
    });
    let posted: Record<string, unknown> | null = null;
    fetchMock.mockImplementation(
      routeFetch(
        {
          '/api/recipes/import': { draft, unmatchedCount: 0 },
          '/api/ingredients': [],
          'POST /api/recipes': ({ json }) => {
            posted = json<Record<string, unknown>>();
            return jsonResponse(201, { id: 'r1' });
          },
        },
        { unmatched: '404' },
      ),
    );

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    submit(root);
    await vi.waitFor(() => expect(root.querySelector('.import-review')).not.toBeNull());

    setField(root, 'title', '  Corrected title  ');
    setField(root, 'servings', '');
    setField(root, 'prep min', '15');
    setField(root, 'steps', 'Step one\n\n  \nStep two');

    root.querySelector<HTMLButtonElement>('.import-footer .btn-primary')!.click();
    await vi.waitFor(() => expect(posted).not.toBeNull());

    expect(posted).toMatchObject({
      title: 'Corrected title',
      servings: 4,
      prepTime: 15,
      steps: ['Step one', 'Step two'],
    });
    expect(posted!['servings']).not.toBeNull();
  });
});
