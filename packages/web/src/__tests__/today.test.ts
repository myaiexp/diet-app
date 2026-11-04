// Today screen slot rows: actions, cook/rate modals, 404 means unrated

import './pin-sunday.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import { todayScreen } from '../screens/today/index.js';
import { makeCtx, mountRoot, pathOf } from './harness.js';
import { makeEntry, makePantryItem } from './fixtures.js';
import { buildRouter } from './today-test-helpers.js';

let fetchMock: ReturnType<typeof vi.fn>;

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

describe('today slots', () => {
  test('shows a state-dependent action for each of the four slots', async () => {
    const entries = [
      makeEntry({ id: 'e-rated', slot: 'breakfast', status: 'cooked', freeformNote: 'Rahka bowl' }),
      makeEntry({ id: 'e-unrated', slot: 'lunch', status: 'cooked', freeformNote: 'Ruisleipä' }),
      makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' }),
      // snack left empty on purpose
    ];
    fetchMock.mockImplementation(buildRouter({ entries, ratedEntryIds: ['e-rated'] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const rows = [...root.querySelectorAll('.today-slot-row')];
    expect(rows).toHaveLength(4);

    const [breakfast, lunch, dinner, snack] = rows;
    expect(breakfast!.classList.contains('is-dimmed')).toBe(true);
    expect(breakfast!.querySelector('button')).toBeNull();

    expect(lunch!.classList.contains('is-dimmed')).toBe(false);
    expect(lunch!.querySelector('button')?.textContent).toBe('rate');

    const cookBtn = dinner!.querySelector<HTMLButtonElement>('button');
    expect(cookBtn?.textContent).toBe('cook →');
    expect(cookBtn?.className).toContain('btn-primary');

    expect(snack!.querySelector('button')?.textContent).toBe('fill');
  });

  test('two entries in one slot each get a row and their own action', async () => {
    const entries = [
      makeEntry({ id: 'e-snack-1', slot: 'snack', status: 'planned', freeformNote: 'Rahka' }),
      makeEntry({ id: 'e-snack-2', slot: 'snack', status: 'cooked', freeformNote: 'Omena' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const rows = [...root.querySelectorAll('.today-slot-row')];
    expect(rows).toHaveLength(5);
    const [first, second] = rows.slice(3);
    expect(first!.querySelector('.today-slot-name')?.textContent).toBe('snack');
    expect(first!.querySelector('.row-title')?.textContent).toBe('Rahka');
    expect(first!.querySelector('button')?.textContent).toBe('cook →');
    expect(second!.querySelector('.today-slot-name')?.textContent).toBe('snack');
    expect(second!.querySelector('.row-title')?.textContent).toBe('Omena');
    expect(second!.querySelector('button')?.textContent).toBe('rate');
  });

  test('cook → opens the cook modal and a successful cook flips the slot', async () => {
    const entries = [
      makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', freeformNote: 'Lohikeitto' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, pantry: [makePantryItem()] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const cookBtn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'cook →')!;
    cookBtn.click();

    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => pathOf(String(u)).includes('/cook-preview'))).toBe(true),
    );
    expect(isModalOpen()).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());

    document.querySelector<HTMLButtonElement>('.cook-commit')!.click();

    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            pathOf(String(url)) === '/api/meal-plans/e-planned/cook' &&
            (init as RequestInit | undefined)?.method === 'POST',
        ),
      ).toBe(true),
    );

    await vi.waitFor(() => {
      const dinner = [...root.querySelectorAll('.today-slot-row')].find(
        (r) => r.querySelector('.today-slot-name')?.textContent === 'dinner',
      )!;
      expect(dinner.querySelector('button')?.textContent).toBe('rate');
      expect(dinner.textContent).toMatch(/cooked/i);
    });
  });

  test('rate on an unrated cooked slot opens the feedback modal', async () => {
    const entries = [
      makeEntry({ id: 'e-unrated', slot: 'lunch', status: 'cooked', freeformNote: 'Ruisleipä' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries, pantry: [makePantryItem()], ratedEntryIds: [] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const rateBtn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'rate')!;
    rateBtn.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.modal-title')?.textContent).toBe('Cook feedback');
    expect(document.querySelector('.cook-chip-row')).not.toBeNull();
    expect(document.querySelector('.cook-feedback-save')).not.toBeNull();
  });

  test('an empty slot opens the add-entry affordance without navigating', async () => {
    // A non-empty pantry keeps this out of the first-run state, which has no
    // per-slot fill buttons at all.
    fetchMock.mockImplementation(buildRouter({ pantry: [makePantryItem()] }));
    const root = mountRoot();
    const ctx = makeCtx();
    await todayScreen().mount(root, ctx);

    const fillBtn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'fill')!;
    fillBtn.click();

    expect(isModalOpen()).toBe(true);
    expect(document.querySelector('.add-entry-picker')).not.toBeNull();
    expect(ctx.navigate).not.toHaveBeenCalled();
  });

  test('a cooked slot shows what was cooked, a planned slot what was planned', async () => {
    // Same figure the plan grid shows for the same entry (plan.test.ts).
    const entries = [
      makeEntry({ id: 'e-cooked', slot: 'lunch', status: 'cooked', servings: '2', actualServings: '5' }),
      makeEntry({ id: 'e-planned', slot: 'dinner', status: 'planned', servings: '2' }),
    ];
    fetchMock.mockImplementation(buildRouter({ entries }));
    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    const metaOf = (slot: string) =>
      [...root.querySelectorAll('.today-slot-row')]
        .find((r) => r.querySelector('.today-slot-name')?.textContent === slot)
        ?.querySelector('.row-meta')?.textContent;
    expect(metaOf('lunch')).toBe('5 serv');
    expect(metaOf('dinner')).toBe('2 serv');
  });

  test('a 404 from getFeedback means unrated, not an error banner', async () => {
    const entries = [makeEntry({ id: 'e-unrated', slot: 'breakfast', status: 'cooked', freeformNote: 'Bowl' })];
    fetchMock.mockImplementation(buildRouter({ entries, ratedEntryIds: [] }));

    const root = mountRoot();
    await todayScreen().mount(root, makeCtx());

    expect(document.querySelector('.error-panel')).toBeNull();
    const row = root.querySelector('.today-slot-row')!;
    expect(row.querySelector('button')?.textContent).toBe('rate');
  });
});
