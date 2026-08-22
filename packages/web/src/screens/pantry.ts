// Pantry screen: spoilage-first list, client-side location filter, add/edit/delete.
//
// Rows never re-sort what the API returns (spoilage order, id tie-break) and
// always render the API's `status` — days-remaining is display-only maths on
// top of it, never a substitute for it. See pantry-form.ts for the add/edit
// modals, kept separate to stay under the file-length limit.

import '../css/pantry.css';
import type { Screen, ScreenContext } from '../router.js';
import type { Ingredient, PantryItem, PantryLocation } from '../api/types.js';
import { LOCATIONS } from '../api/types.js';
import { listPantry } from '../api/pantry.js';
import { userMessage } from '../api/errors.js';
import { el, button, errorPanel, loadingRow } from '../ui/dom.js';
import { say } from '../ui/toast.js';
import { attachIngredientSearch, INGREDIENT_SEARCH_PLACEHOLDER } from '../ui/ingredient-picker.js';
import { openAddItemModal, openEditItemModal } from './pantry-form.js';
import { buildPantryRow } from './pantry-row.js';

const PAGE_SIZE = 50;
const FILTERS: ReadonlyArray<PantryLocation | 'all'> = ['all', ...LOCATIONS];

export function pantryScreen(): Screen {
  let items: PantryItem[] = [];
  let activeLocation: PantryLocation | 'all' = 'all';
  let hasMore = false;
  let loadingMore = false;
  let destroyed = false;
  let ctx: ScreenContext;

  let listEl: HTMLElement;
  let chipsEl: HTMLElement;
  let tailEl: HTMLElement;

  // Every pantry endpoint eager-loads `ingredient`, so a page of rows arrives
  // ready to render — no per-row name lookup.
  function loadPage(offset: number, limit: number): Promise<PantryItem[]> {
    return listPantry({ limit, offset });
  }

  function updateSubtitle(): void {
    const n = items.length;
    ctx.setSubtitle(`${n} item${n === 1 ? '' : 's'} · spoilage order`);
  }

  function countFor(loc: PantryLocation | 'all'): number {
    return loc === 'all' ? items.length : items.filter((i) => i.location === loc).length;
  }

  function renderChips(): void {
    chipsEl.replaceChildren(
      ...FILTERS.map((loc) => {
        const chip = button(`chip${loc === activeLocation ? ' is-on' : ''}`, '', () => {
          activeLocation = loc;
          renderChips();
          renderList();
        });
        chip.append(loc, ' ', el('span', { class: 'chip-count' }, String(countFor(loc))));
        return chip;
      }),
    );
  }

  function openRowMenu(item: PantryItem): void {
    openEditItemModal(item, item.ingredient, {
      onSaved: (row) => {
        items = items.map((i) => (i.id === row.id ? row : i));
        renderChips();
        renderList();
        updateSubtitle();
      },
      onDeleted: (id) => {
        items = items.filter((i) => i.id !== id);
        renderChips();
        renderList();
        updateSubtitle();
      },
    });
  }

  function openAdd(preset?: Ingredient): void {
    openAddItemModal({ onCreated: () => void reloadAll() }, preset);
  }

  function renderList(): void {
    const visible =
      activeLocation === 'all' ? items : items.filter((i) => i.location === activeLocation);
    listEl.replaceChildren();

    if (items.length === 0) {
      listEl.appendChild(
        el(
          'div',
          { class: 'empty-state' },
          el('h1', {}, 'Pantry is empty'),
          el(
            'p',
            {},
            'Nothing tracked yet. Add what is in your fridge, freezer, pantry or counter to start planning around it.',
          ),
          button('btn btn-primary', '+ add first item', () => openAdd()),
        ),
      );
    } else if (visible.length === 0) {
      listEl.appendChild(
        el('div', { class: 'empty-state' }, el('p', {}, `Nothing in ${activeLocation}.`)),
      );
    } else {
      for (const item of visible) {
        listEl.appendChild(buildPantryRow(item, item.ingredient, () => openRowMenu(item)));
      }
    }

    tailEl.replaceChildren();
    if (hasMore) {
      tailEl.appendChild(
        button(
          'btn btn-ghost',
          loadingMore ? 'loading…' : 'load more',
          () => void loadMore(),
          { disabled: loadingMore },
        ),
      );
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore || !hasMore) return;
    loadingMore = true;
    renderList();
    try {
      const rows = await loadPage(items.length, PAGE_SIZE);
      if (destroyed) return;
      items = [...items, ...rows];
      hasMore = rows.length === PAGE_SIZE;
    } catch (e) {
      say(userMessage(e), 'error');
    } finally {
      loadingMore = false;
      if (!destroyed) {
        renderChips();
        renderList();
        updateSubtitle();
      }
    }
  }

  /** After a create/edit that may have moved an item's spoilage position. */
  async function reloadAll(): Promise<void> {
    const limit = Math.max(PAGE_SIZE, items.length);
    try {
      const rows = await loadPage(0, limit);
      if (destroyed) return;
      items = rows;
      hasMore = rows.length === limit;
      renderChips();
      renderList();
      updateSubtitle();
    } catch (e) {
      say(userMessage(e), 'error');
    }
  }

  async function loadInitial(): Promise<void> {
    listEl.replaceChildren(loadingRow('loading pantry…'));
    try {
      const rows = await loadPage(0, PAGE_SIZE);
      if (destroyed) return;
      items = rows;
      hasMore = rows.length === PAGE_SIZE;
      renderChips();
      renderList();
      updateSubtitle();
    } catch (e) {
      if (destroyed) return;
      listEl.replaceChildren(errorPanel(userMessage(e), () => void loadInitial()));
    }
  }

  return {
    title: 'Pantry',
    subtitle: 'spoilage order',
    async mount(root, screenCtx) {
      ctx = screenCtx;
      destroyed = false;
      items = [];
      activeLocation = 'all';

      const searchInput = el('input', {
        class: 'input',
        type: 'text',
        placeholder: INGREDIENT_SEARCH_PLACEHOLDER,
      }) as HTMLInputElement;
      const searchResults = el('div', { class: 'pantry-search-results' });
      attachIngredientSearch(searchInput, searchResults, (ing) => {
        searchInput.value = '';
        searchResults.replaceChildren();
        openAdd(ing);
      });
      const addBtn = button('btn btn-primary btn-sm', '+ add', () => openAdd());

      chipsEl = el('div', { class: 'bar-wrap flex gap-2' });
      const bar = el(
        'div',
        // .bar carries the opaque background .bar-sticky deliberately omits.
        { class: 'bar bar-col bar-sticky' },
        chipsEl,
        el(
          'div',
          { class: 'flex gap-2' },
          el('div', { class: 'pantry-search-wrap' }, searchInput, searchResults),
          addBtn,
        ),
      );

      listEl = el('div', { class: 'pantry-list' });
      tailEl = el('div', { class: 'pantry-tail' });

      root.append(bar, el('div', { class: 'section-header' }, 'sorted by expiry · soonest first'), listEl, tailEl);

      await loadInitial();
    },
    unmount() {
      destroyed = true;
    },
  };
}
