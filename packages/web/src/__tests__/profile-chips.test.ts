// Profile text-chip add form: Enter, blur, trim, dedupe, Escape.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { profileScreen } from '../screens/profile.js';
import { flush, makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeProfile } from './fixtures.js';

const PROFILE = makeProfile({
  dislikedIngredientIds: [],
  dietaryRestrictions: ['no shellfish', 'low lactose'],
  kitchenEquipment: ['oven'],
});

function chipPanel(root: HTMLElement, header: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.profile-chip-panel')].find(
    (p) => p.querySelector('.section-header')?.textContent === header,
  );
  if (!found) throw new Error(`chip panel not found: ${header}`);
  return found;
}

function startAdd(panel: HTMLElement): HTMLInputElement {
  const button = panel.querySelector<HTMLButtonElement>('.btn-ghost');
  if (!button) throw new Error('add button missing');
  button.click();
  const input = panel.querySelector('input');
  if (!input) throw new Error('add input not shown');
  return input;
}

let patchCalls: Array<Record<string, unknown>>;

beforeEach(() => {
  document.body.replaceChildren();
  patchCalls = [];
  const fetchMock = vi.fn(
    routeFetch(
      {
        'GET /api/profile': PROFILE,
        'PATCH /api/profile': ({ json }) => {
          const body = json<Record<string, unknown>>();
          patchCalls.push(body);
          return { ...PROFILE, ...body };
        },
      },
      { unmatched: '404' },
    ),
  );
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => resetClient());

async function mount(): Promise<HTMLElement> {
  const root = mountRoot();
  await profileScreen().mount(root, makeCtx());
  return root;
}

describe('profile text-chip add form', () => {
  test('Enter trims, PATCHes once, and a following blur does not send a second write', async () => {
    const root = await mount();
    const input = startAdd(chipPanel(root, 'dietary restrictions'));
    input.value = '  vegan ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new Event('blur'));

    await vi.waitFor(() => expect(patchCalls).toHaveLength(1));
    await flush();
    expect(patchCalls).toEqual([
      { dietaryRestrictions: ['no shellfish', 'low lactose', 'vegan'] },
    ]);
  });

  test('a duplicate value sends no PATCH and restores the add button', async () => {
    const root = await mount();
    const panel = chipPanel(root, 'dietary restrictions');
    const input = startAdd(panel);
    input.value = '  no shellfish  ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(patchCalls).toHaveLength(0);
    expect(panel.querySelector('input')).toBeNull();
    expect(panel.querySelector('.btn-ghost')?.textContent).toBe('+ add');
  });

  test('Escape sends no PATCH and restores the add button', async () => {
    const root = await mount();
    const panel = chipPanel(root, 'dietary restrictions');
    const input = startAdd(panel);
    input.value = 'vegan';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();

    expect(patchCalls).toHaveLength(0);
    expect(panel.querySelector('input')).toBeNull();
    expect(panel.querySelector('.btn-ghost')?.textContent).toBe('+ add');
  });

  test('the kitchen panel writes kitchenEquipment, not dietaryRestrictions', async () => {
    const root = await mount();
    const input = startAdd(chipPanel(root, 'kitchen equipment'));
    input.value = ' air fryer ';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    await vi.waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls).toEqual([{ kitchenEquipment: ['oven', 'air fryer'] }]);
  });
});
