// Profile screen: every write is a whitelisted, diff-only PATCH. These tests
// pin the four things that make that safe — only changed fields are sent, an
// empty diff never calls the API, nullable targets clear with an explicit
// null (never omitted, never 0), and scheduleProfile is always an object
// (the design doc shows free text; the API's schema is z.record(...) and a
// bare string is a 400) — plus that dislikedIngredientIds round-trips ids to
// names for display and back to a uuid array on write.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal } from '../ui/modal.js';
import { profileScreen } from '../screens/profile.js';
import type { UserProfile, Ingredient } from '../api/types.js';
import { flush, jsonResponse, makeCtx, mountRoot, pathOf, routeFetch } from './harness.js';
import { makeIngredient, makeProfile } from './fixtures.js';

const WHITELIST = [
  'name', 'calorieTargetMin', 'calorieTargetMax', 'macroTargets', 'dietaryRestrictions',
  'cookingSkill', 'kitchenEquipment', 'householdSize', 'scheduleProfile', 'dislikedIngredientIds',
];

const INGREDIENTS: Record<string, Ingredient> = {
  'ing-1': ing('ing-1', 'Coriander'),
  'ing-2': ing('ing-2', 'Liver'),
  'ing-3': ing('ing-3', 'Blue cheese'),
};

function ing(id: string, name: string): Ingredient {
  return makeIngredient({ id, name, aliases: [], category: 'other', defaultUnit: 'g' });
}

/** A minimal stateful fake of the profile + ingredients endpoints. Every
 * PATCH shallow-merges the sent body into the stored row — that mirrors the
 * real route, since the client only ever sends whole objects/arrays for the
 * jsonb and array columns, never a partial one. */
function makeServer(initial: UserProfile) {
  let profile = initial;
  const patchCalls: Array<Record<string, unknown>> = [];
  const handle = routeFetch(
    {
      'GET /api/profile': () => profile,
      'PATCH /api/profile': ({ json }) => {
        const body = json<Record<string, unknown>>();
        patchCalls.push(body);
        profile = { ...profile, ...body } as UserProfile;
        return profile;
      },
      'GET /api/ingredients/:id': ({ params }) => {
        const found = INGREDIENTS[params['id']!];
        return found ?? jsonResponse(404, { error: 'Not found' });
      },
      'GET /api/ingredients': ({ url }) => {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        return Object.values(INGREDIENTS).filter((i) => i.name.toLowerCase().includes(q));
      },
    },
    { unmatched: '404' },
  );
  return { handle, patchCalls, current: () => profile };
}

/** Fields are rendered as `<label class="profile-field">{text}{control}</label>`
 * — the control contributes no text, so the label's own text is a reliable prefix. */
function fieldControl(root: HTMLElement, label: string): HTMLInputElement {
  const found = [...root.querySelectorAll<HTMLElement>('.profile-field')].find((l) =>
    l.textContent?.startsWith(label),
  );
  if (!found) throw new Error(`field not found: ${label}`);
  return found.querySelector('input, select') as HTMLInputElement;
}

function saveButton(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.btn-primary')!;
}

function chipPanel(root: HTMLElement, header: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('.profile-chip-panel')].find(
    (p) => p.querySelector('.section-header')?.textContent === header,
  );
  if (!found) throw new Error(`chip panel not found: ${header}`);
  return found;
}

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

describe('profile screen', () => {
  test('sends only the changed field in the PATCH body', async () => {
    const server = makeServer(makeProfile());
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    fieldControl(root, 'household').value = '4';
    saveButton(root).click();
    await flush();

    expect(server.patchCalls).toHaveLength(1);
    expect(server.patchCalls[0]).toEqual({ householdSize: 4 });
  });

  test('never sends a key outside the strict PATCH whitelist', async () => {
    const server = makeServer(makeProfile());
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    fieldControl(root, 'name').value = 'New Name';
    fieldControl(root, 'protein g').value = '140';
    saveButton(root).click();
    await flush();

    expect(server.patchCalls.length).toBeGreaterThan(0);
    for (const call of server.patchCalls) {
      expect(Object.keys(call).every((k) => WHITELIST.includes(k))).toBe(true);
    }
  });

  test('resolves disliked ingredient ids to names, and PATCHes a uuid array on removal', async () => {
    const server = makeServer(makeProfile({ dislikedIngredientIds: ['ing-1', 'ing-2'] }));
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    const panel = chipPanel(root, 'disliked ingredients');
    const chips = [...panel.querySelectorAll('.chip')];
    expect(chips.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Coriander'), expect.stringContaining('Liver')]),
    );

    panel.querySelectorAll<HTMLButtonElement>('.chip-x')[0]!.click();
    await flush();

    expect(server.patchCalls).toHaveLength(1);
    const sent = server.patchCalls[0]!['dislikedIngredientIds'];
    expect(Array.isArray(sent)).toBe(true);
    expect(sent).toEqual(['ing-2']);
  });

  test('adds a disliked ingredient via debounced search and PATCHes the full array', async () => {
    const server = makeServer(makeProfile({ dislikedIngredientIds: ['ing-1'] }));
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    const panel = chipPanel(root, 'disliked ingredients');
    panel.querySelector<HTMLButtonElement>('.btn-ghost')!.click();
    const input = panel.querySelector<HTMLInputElement>('.pantry-search-wrap input')!;
    input.value = 'liver';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => {
      expect(panel.querySelector('.pantry-search-result')).not.toBeNull();
    });

    const result = panel.querySelector<HTMLButtonElement>('.pantry-search-result')!;
    expect(result.textContent).toContain('Liver');
    result.click();
    await flush();

    expect(server.patchCalls.at(-1)).toEqual({ dislikedIngredientIds: ['ing-1', 'ing-2'] });
  });

  test('clears a nullable target by sending null, leaving the other one omitted', async () => {
    const server = makeServer(makeProfile({ calorieTargetMin: 2100, calorieTargetMax: 2500 }));
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    fieldControl(root, 'kcal max').value = '';
    saveButton(root).click();
    await flush();

    expect(server.patchCalls).toHaveLength(1);
    expect(server.patchCalls[0]).toEqual({ calorieTargetMax: null });
    expect(server.patchCalls[0]).not.toHaveProperty('calorieTargetMin');
  });

  test('wraps the schedule text as { note } rather than sending a bare string', async () => {
    const server = makeServer(makeProfile({ scheduleProfile: { note: 'old note' } }));
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    fieldControl(root, 'schedule profile').value = 'late shift tue+thu · long weekend cooking';
    saveButton(root).click();
    await flush();

    expect(server.patchCalls).toHaveLength(1);
    expect(server.patchCalls[0]).toEqual({
      scheduleProfile: { note: 'late shift tue+thu · long weekend cooking' },
    });
  });

  test('states each chip panel’s filter semantics', async () => {
    const server = makeServer(makeProfile());
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    const text = root.textContent ?? '';
    expect(text).toContain('hard filter');
    expect(text).toContain('soft — down-weighted, never blocked');
    expect(text).toContain('gates suggestions');
  });

  test("surfaces the API's calorieTargetMin > calorieTargetMax validation message", async () => {
    const server = makeServer(makeProfile());
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (pathOf(input) === '/api/profile' && (init?.method ?? 'GET') === 'PATCH') {
        return jsonResponse(400, {
          error: 'Validation failed',
          details: { formErrors: ['calorieTargetMin must be ≤ calorieTargetMax'] },
        });
      }
      return server.handle(input, init);
    });
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    fieldControl(root, 'kcal min').value = '3000';
    saveButton(root).click();
    await flush();

    expect(root.querySelector('.helper-error')?.textContent).toContain(
      'calorieTargetMin must be ≤ calorieTargetMax',
    );
  });

  test('does not send a request at all when nothing changed', async () => {
    const server = makeServer(makeProfile());
    fetchMock.mockImplementation(server.handle);
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    saveButton(root).click();
    await flush();

    expect(server.patchCalls).toHaveLength(0);
  });

  test('renders a clear empty state when no profile row exists (404), without crashing', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(404, { error: 'Not found' }));
    const root = mountRoot();
    await profileScreen().mount(root, makeCtx());

    expect(root.querySelector('.empty-state')).not.toBeNull();
    expect(root.textContent ?? '').toMatch(/no profile/i);
  });
});
