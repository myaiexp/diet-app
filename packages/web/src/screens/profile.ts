// Profile screen: targets panel + three chip panels. Every write is a
// whitelisted, diff-only PATCH — ProfilePatch IS the whitelist (an extra key
// is a TS error here, a 400 on the wire) — and a no-op save never calls the
// API (an empty PATCH body is a 400 server-side). dislikedIngredientIds is a
// uuid array on a junction table; ids resolve to names once at load, and
// every add/remove PATCHes the full next array.

import '../css/profile.css';
import type { Screen, ScreenContext } from '../router.js';
import type { UserProfile, ProfilePatch, CookingSkill } from '../api/types.js';
import { getProfile, patchProfile } from '../api/profile.js';
import { getIngredient } from '../api/ingredients.js';
import { userMessage, fieldErrors, isApiError } from '../api/errors.js';
import { el, button, errorPanel, loadingRow } from '../ui/dom.js';
import { field, errorBox, showError, hideError } from '../ui/form.js';
import { attachIngredientSearch } from '../ui/ingredient-picker.js';
import { say } from '../ui/toast.js';

const SKILLS: readonly CookingSkill[] = ['beginner', 'competent', 'advanced'];

const profileField = (label: string, node: HTMLElement): HTMLElement =>
  field(label, node, { as: 'label', class: 'profile-field' });
const numField = (v: number | string | null): HTMLInputElement =>
  el('input', { class: 'input', type: 'number', value: v ?? '' }) as HTMLInputElement;
const chipEl = (label: string, onRemove: () => void): HTMLElement =>
  el('span', { class: 'chip profile-chip' }, label, button('chip-x', '×', onRemove, { 'aria-label': `remove ${label}` }));

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const scheduleNote = (p: UserProfile): string =>
  typeof p.scheduleProfile['note'] === 'string' ? (p.scheduleProfile['note'] as string) : '';
const macroValue = (m: Record<string, number> | null, k: string): string =>
  typeof m?.[k] === 'number' ? String(m[k]) : '';

/** Order-independent equality for the small macroTargets objects. */
function sameMacro(a: Record<string, number> | null, b: Record<string, number> | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((k, idx) => k === bk[idx] && a[k] === b[k]);
}

/** Merges the three rendered keys into whatever macroTargets keys already exist. */
function nextMacro(original: Record<string, number> | null, protein: string, carbs: string, fat: string): Record<string, number> | null {
  const next: Record<string, number> = { ...(original ?? {}) };
  for (const [key, raw] of [['protein', protein], ['carbs', carbs], ['fat', fat]] as const) {
    const t = raw.trim();
    if (t === '') delete next[key]; else next[key] = Number(t);
  }
  return Object.keys(next).length ? next : null;
}

interface TargetsInputs {
  name: HTMLInputElement; calorieMin: HTMLInputElement; calorieMax: HTMLInputElement;
  protein: HTMLInputElement; carbs: HTMLInputElement; fat: HTMLInputElement;
  householdSize: HTMLInputElement; cookingSkill: HTMLSelectElement; schedule: HTMLInputElement;
}

/** Diff-only: a key lands in the patch only when it differs from `profile`. */
function buildTargetsPatch(profile: UserProfile, i: TargetsInputs): ProfilePatch {
  const patch: ProfilePatch = {};
  const name = i.name.value.trim();
  if (name && name !== profile.name) patch.name = name;
  const min = numOrNull(i.calorieMin.value);
  if (min !== profile.calorieTargetMin) patch.calorieTargetMin = min;
  const max = numOrNull(i.calorieMax.value);
  if (max !== profile.calorieTargetMax) patch.calorieTargetMax = max;
  const macro = nextMacro(profile.macroTargets, i.protein.value, i.carbs.value, i.fat.value);
  if (!sameMacro(macro, profile.macroTargets)) patch.macroTargets = macro;
  const household = Number(i.householdSize.value);
  if (Number.isFinite(household) && household > 0 && household !== profile.householdSize) patch.householdSize = household;
  const skill = i.cookingSkill.value as CookingSkill;
  if (skill !== profile.cookingSkill) patch.cookingSkill = skill;
  // CORRECTION to the design doc: scheduleProfile is a jsonb object, not free
  // text — the API rejects a bare string, so the text field is wrapped as `{ note }`.
  const note = i.schedule.value.trim();
  if (note !== scheduleNote(profile)) patch.scheduleProfile = { ...profile.scheduleProfile, note };
  return patch;
}

function buildTargetsPanel(profile: UserProfile, onUpdated: (p: UserProfile) => void): HTMLElement {
  const name = el('input', { class: 'input', type: 'text', value: profile.name }) as HTMLInputElement;
  const calorieMin = numField(profile.calorieTargetMin);
  const calorieMax = numField(profile.calorieTargetMax);
  const protein = numField(macroValue(profile.macroTargets, 'protein'));
  const carbs = numField(macroValue(profile.macroTargets, 'carbs'));
  const fat = numField(macroValue(profile.macroTargets, 'fat'));
  const householdSize = el('input', { class: 'input', type: 'number', min: '1', value: profile.householdSize }) as HTMLInputElement;
  const cookingSkill = el('select', { class: 'select' }) as HTMLSelectElement;
  for (const s of SKILLS) cookingSkill.appendChild(el('option', { value: s, selected: s === profile.cookingSkill }, s));
  const schedule = el('input', {
    class: 'input', type: 'text', value: scheduleNote(profile), placeholder: 'late shift tue+thu · long weekend cooking',
  }) as HTMLInputElement;
  const errBox = errorBox();
  const inputs: TargetsInputs = { name, calorieMin, calorieMax, protein, carbs, fat, householdSize, cookingSkill, schedule };

  async function save(): Promise<void> {
    const patch = buildTargetsPatch(profile, inputs);
    if (Object.keys(patch).length === 0) return;
    try {
      const updated = await patchProfile(patch);
      say('Profile saved.');
      hideError(errBox);
      onUpdated(updated);
    } catch (e) {
      showError(errBox, userMessage(e), fieldErrors(e));
    }
  }

  return el(
    'div', { class: 'panel panel-pad profile-targets' },
    el('div', { class: 'section-header' }, 'targets'),
    profileField('name', name),
    el('div', { class: 'flex gap-2' }, profileField('kcal min', calorieMin), profileField('kcal max', calorieMax)),
    el('div', { class: 'flex gap-2' }, profileField('protein g', protein), profileField('carbs g', carbs), profileField('fat g', fat)),
    el('div', { class: 'flex gap-2' }, profileField('household', householdSize), profileField('skill', cookingSkill)),
    profileField('schedule profile', schedule),
    el('p', { class: 'helper' }, 'low-effort on late-shift days, effort ≤ 2 on weeknights'),
    errBox,
    button('btn btn-primary', 'save', () => void save()),
  );
}

function chipPanelShell(header: string, note: string, list: HTMLElement, addSlot: HTMLElement): HTMLElement {
  return el(
    'div', { class: 'panel panel-pad profile-chip-panel' },
    el('div', { class: 'section-header' }, header),
    el('p', { class: 'helper' }, note),
    list, addSlot,
  );
}

interface TextChipConfig {
  header: string; note: string; placeholder: string; values: string[];
  field: 'dietaryRestrictions' | 'kitchenEquipment'; onUpdated: (p: UserProfile) => void;
}

/** Shared shape for the two plain `text[]` chip panels. */
function buildTextChipPanel(cfg: TextChipConfig): HTMLElement {
  const list = el('div', { class: 'flex gap-2 bar-wrap' });
  const addSlot = el('div', {});
  const addButton = button('btn btn-ghost btn-sm', '+ add', () => showAddForm());
  const renderChips = (): void =>
    list.replaceChildren(...cfg.values.map((v) => chipEl(v, () => void commit(cfg.values.filter((x) => x !== v)))));

  async function commit(next: string[]): Promise<void> {
    try { cfg.onUpdated(await patchProfile({ [cfg.field]: next } as ProfilePatch)); }
    catch (e) { say(userMessage(e), 'error'); }
  }

  function showAddForm(): void {
    const input = el('input', { class: 'input', type: 'text', placeholder: cfg.placeholder }) as HTMLInputElement;
    let done = false;
    const submit = (): void => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (v && !cfg.values.includes(v)) void commit([...cfg.values, v]);
      addSlot.replaceChildren(addButton);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') { done = true; addSlot.replaceChildren(addButton); }
    });
    input.addEventListener('blur', submit);
    addSlot.replaceChildren(input);
    input.focus();
  }

  addSlot.appendChild(addButton);
  renderChips();
  return chipPanelShell(cfg.header, cfg.note, list, addSlot);
}

/** Ids resolved to names once at load — a handful of ids, never per-render. */
async function resolveDislikedNames(ids: string[]): Promise<Map<string, string>> {
  const pairs = await Promise.all(
    ids.map(async (id): Promise<[string, string]> => {
      try { return [id, (await getIngredient(id)).name]; } catch { return [id, id]; }
    }),
  );
  return new Map(pairs);
}

function buildDislikedPanel(profile: UserProfile, names: Map<string, string>, onUpdated: (p: UserProfile) => void): HTMLElement {
  const ids = profile.dislikedIngredientIds;
  const list = el('div', { class: 'flex gap-2 bar-wrap' },
    ...ids.map((id) => chipEl(names.get(id) ?? id, () => void commit(ids.filter((x) => x !== id)))));
  const addSlot = el('div', {});
  const addButton = button('btn btn-ghost btn-sm', '+ add', () => showAddForm());

  async function commit(next: string[]): Promise<void> {
    try { onUpdated(await patchProfile({ dislikedIngredientIds: next })); }
    catch (e) { say(userMessage(e), 'error'); }
  }

  function showAddForm(): void {
    const input = el('input', { class: 'input', type: 'text', placeholder: 'search ingredients…' }) as HTMLInputElement;
    const results = el('div', { class: 'pantry-search-results' });
    attachIngredientSearch(
      input,
      results,
      (ing) => {
        names.set(ing.id, ing.name);
        void commit([...ids, ing.id]);
        addSlot.replaceChildren(addButton);
      },
      { filter: (ing) => !ids.includes(ing.id) },
    );
    addSlot.replaceChildren(el('div', { class: 'pantry-search-wrap' }, input, results));
    input.focus();
  }

  addSlot.appendChild(addButton);
  return chipPanelShell('disliked ingredients', 'soft — down-weighted, never blocked', list, addSlot);
}

function emptyProfileState(): HTMLElement {
  return el(
    'div', { class: 'empty-state' },
    el('h1', {}, 'No profile yet'),
    el('p', { class: 'text-pretty' }, 'This single-user app expects one profile row, seeded on the server. None exists yet, so there is nothing to edit here.'),
  );
}

export function profileScreen(): Screen {
  let destroyed = false;

  return {
    title: 'Profile',
    subtitle: 'targets, restrictions, kit',
    async mount(root: HTMLElement, _ctx: ScreenContext): Promise<void> {
      destroyed = false;
      let dislikedNames = new Map<string, string>();
      function paint(profile: UserProfile): void {
        if (destroyed) return;
        root.replaceChildren(el(
          'div', { class: 'profile-grid' },
          buildTargetsPanel(profile, paint),
          buildTextChipPanel({
            header: 'dietary restrictions', note: 'hard filter', placeholder: 'e.g. no shellfish',
            values: profile.dietaryRestrictions ?? [], field: 'dietaryRestrictions', onUpdated: paint,
          }),
          buildDislikedPanel(profile, dislikedNames, paint),
          buildTextChipPanel({
            header: 'kitchen equipment', note: 'gates suggestions', placeholder: 'e.g. oven',
            values: profile.kitchenEquipment ?? [], field: 'kitchenEquipment', onUpdated: paint,
          }),
        ));
      }
      async function load(): Promise<void> {
        root.replaceChildren(loadingRow('loading profile…'));
        try {
          const profile = await getProfile();
          if (destroyed) return;
          dislikedNames = await resolveDislikedNames(profile.dislikedIngredientIds);
          if (destroyed) return;
          paint(profile);
        } catch (e) {
          if (destroyed) return;
          if (isApiError(e) && e.status === 404) { root.replaceChildren(emptyProfileState()); return; }
          root.replaceChildren(errorPanel(userMessage(e), () => void load()));
        }
      }
      await load();
    },
    unmount(): void { destroyed = true; },
  };
}
