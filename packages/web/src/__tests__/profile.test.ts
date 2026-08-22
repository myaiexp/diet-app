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
  return {
    id, name, aliases: [], category: 'other', defaultUnit: 'g',
    nutritionPer100g: null, shelfLife: null, tags: null, isPantryStaple: null,
    createdAt: 't', updatedAt: 't',
  };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'profile-1',
    name: 'Mase',
    calorieTargetMin: 2100,
    calorieTargetMax: 2500,
    macroTargets: { protein: 130, carbs: 230, fat: 80 },
    dietaryRestrictions: ['no shellfish', 'low lactose'],
    cookingSkill: 'competent',
    kitchenEquipment: ['oven', 'hob 4'],
    householdSize: 2,
    scheduleProfile: { note: 'late shift tue+thu' },
    dislikedIngredientIds: ['ing-1', 'ing-2'],
    createdAt: 't',
    updatedAt: 't',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function pathOf(url: string): string {
  return new URL(url, 'http://x').pathname;
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

function makeCtx() {
  return { setSubtitle: vi.fn(), navigate: vi.fn() };
}

/** A minimal stateful fake of the profile + ingredients endpoints. Every
 * PATCH shallow-merges the sent body into the stored row — that mirrors the
 * real route, since the client only ever sends whole objects/arrays for the
 * jsonb and array columns, never a partial one. */
function makeServer(initial: UserProfile) {
  let profile = initial;
  const patchCalls: Array<Record<string, unknown>> = [];
  async function handle(url: string, init?: RequestInit): Promise<Response> {
    const path = pathOf(url);
    const method = init?.method ?? 'GET';
    if (path === '/api/profile' && method === 'GET') return jsonResponse(200, profile);
    if (path === '/api/profile' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      patchCalls.push(body);
      profile = { ...profile, ...body } as UserProfile;
      return jsonResponse(200, profile);
    }
    const m = /^\/api\/ingredients\/(.+)$/.exec(path);
    if (m && method === 'GET') {
      const found = INGREDIENTS[m[1]!];
      return found ? jsonResponse(200, found) : jsonResponse(404, { error: 'Not found' });
    }
    if (path === '/api/ingredients' && method === 'GET') {
      const q = (new URL(url, 'http://x').searchParams.get('q') ?? '').toLowerCase();
      return jsonResponse(200, Object.values(INGREDIENTS).filter((i) => i.name.toLowerCase().includes(q)));
    }
    return jsonResponse(404, { error: 'unhandled' });
  }
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
    await flush(250);

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
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/profile' && method === 'PATCH') {
        return jsonResponse(400, {
          error: 'Validation failed',
          details: { formErrors: ['calorieTargetMin must be ≤ calorieTargetMax'] },
        });
      }
      return server.handle(url, init);
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
