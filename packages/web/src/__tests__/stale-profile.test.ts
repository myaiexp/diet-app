// Profile screen stale guard: a panel write that settles after the user
// navigated away does not repaint the screen with the returned profile.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { profileScreen } from '../screens/profile.js';
import { jsonResponse, makeCtx, mountRoot, routeFetch } from './harness.js';
import { makeIngredient, makeProfile } from './fixtures.js';
import { FRESH_THEN_STALE, hold, settleWith } from './stale-probe.js';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe.each(FRESH_THEN_STALE)('profile screen, $mode when the call settles', ({ stale }) => {
  test('removing a disliked ingredient', async () => {
    const profile = makeProfile({ dislikedIngredientIds: ['ing-1', 'ing-2'] });
    const patch = hold<unknown>();
    fetchMock.mockImplementation(
      routeFetch(
        {
          'GET /api/profile': profile,
          'PATCH /api/profile': patch.handler,
          'GET /api/ingredients/:id': ({ params }) =>
            params['id'] === 'ing-1' || params['id'] === 'ing-2'
              ? makeIngredient({ id: params['id'], name: `Name ${params['id']}` })
              : jsonResponse(404, { error: 'Not found' }),
        },
        { unmatched: '404' },
      ),
    );
    const root = mountRoot();
    const ctx = makeCtx();
    await profileScreen().mount(root, ctx);
    root.querySelector<HTMLButtonElement>('.chip-x')!.click();
    await patch.requested();
    // paint() replaces the whole grid; the panel's own bookkeeping may touch
    // nodes inside it either way, so identity is the signal, not mutation.
    const grid = root.firstElementChild;

    const wrote = await settleWith(root, ctx, stale, () =>
      patch.resolve({ ...profile, dislikedIngredientIds: ['ing-2'] }),
    );

    expect(root.firstElementChild !== grid).toBe(!stale);
    expect(wrote.toast).toBe(null);
  });
});
