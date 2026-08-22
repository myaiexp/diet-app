// Shopping list screen: current-week list, aisle-grouped rows, bought toggle,
// regenerate / complete, and the ad-hoc add.
//
// See groups.ts for the pure aisle bucketing (must never re-sort
// within a group — the server already put staples last) and
// row.ts / header.ts for the split-out DOM builders.

import '../../css/shopping.css';
import type { Screen, ScreenContext } from '../../router.js';
import type {
  ShoppingList,
  ShoppingItem,
  SkippedGenerateLine,
  SkippedCompleteItem,
} from '../../api/types.js';
import { getCurrentShoppingList, patchShoppingItem, deleteShoppingItem } from '../../api/shopping.js';
import { userMessage, isApiError } from '../../api/errors.js';
import { el, button, errorPanel, loadingRow } from '../../ui/dom.js';
import { say } from '../../ui/toast.js';
import { isoToday, isoWeekNumber } from '../../format/date.js';
import { groupByAisle, categoryColor } from './groups.js';
import { buildShoppingRow } from './row.js';
import {
  buildShoppingHeader,
  runGenerate,
  type HeaderHandlers,
  type HeaderState,
} from './header.js';
import { describeSkippedGenerate, describeSkippedComplete } from './notices.js';

export function shoppingScreen(): Screen {
  let list: ShoppingList | null = null;
  let notices: string[] = [];
  // Per-shop, never persisted — the API takes includeOptional on the generate
  // body rather than storing it on the list, so it resets with the screen.
  let includeOptional = false;
  let destroyed = false;
  let ctx: ScreenContext;
  let bodyEl: HTMLElement;

  function updateSubtitle(): void {
    if (!list) {
      ctx.setSubtitle('aisle order · needed minus pantry');
      return;
    }
    const bought = list.items.filter((i) => i.bought).length;
    ctx.setSubtitle(`${bought} of ${list.items.length} bought · vk ${isoWeekNumber(list.weekStarting)}`);
  }

  function replaceItem(id: string, patch: Partial<ShoppingItem>): void {
    if (!list) return;
    list = { ...list, items: list.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
  }

  function removeItemLocal(id: string): void {
    if (!list) return;
    list = { ...list, items: list.items.filter((i) => i.id !== id) };
  }

  async function toggleBought(item: ShoppingItem): Promise<void> {
    if (!list || list.status === 'done') return;
    const wasBought = item.bought;
    replaceItem(item.id, { bought: !wasBought });
    render();
    try {
      const updated = await patchShoppingItem(item.id, { bought: !wasBought });
      if (destroyed) return;
      replaceItem(item.id, updated);
      render();
    } catch (e) {
      if (destroyed) return;
      replaceItem(item.id, { bought: wasBought });
      render();
      say(userMessage(e), 'error');
    }
  }

  async function removeRow(item: ShoppingItem): Promise<void> {
    if (!list || list.status === 'done') return;
    try {
      await deleteShoppingItem(item.id);
      if (destroyed) return;
      removeItemLocal(item.id);
      render();
      updateSubtitle();
      // Deliberate, documented API behaviour, not a bug: a generated row
      // reappears on the next regenerate. There is no later moment the user
      // would connect the two, so the warning has to land now.
      if (item.source === 'generated') {
        say('Removed — regenerating the list will bring it back.', 'warning');
      }
    } catch (e) {
      say(userMessage(e), 'error');
    }
  }

  function handleGenerated(newList: ShoppingList, skipped: SkippedGenerateLine[]): void {
    if (destroyed) return;
    list = newList;
    notices = skipped.length > 0 ? [describeSkippedGenerate(skipped)] : [];
    render();
    updateSubtitle();
  }

  function handleCompleted(newList: ShoppingList, skipped: SkippedCompleteItem[]): void {
    if (destroyed) return;
    list = newList;
    if (skipped.length > 0) notices = [...notices, describeSkippedComplete(skipped)];
    render();
    updateSubtitle();
  }

  function handleItemCreated(item: ShoppingItem): void {
    if (destroyed || !list) return;
    list = { ...list, items: [...list.items, item] };
    render();
    updateSubtitle();
  }

  function dismissNotice(index: number): void {
    notices = notices.filter((_, i) => i !== index);
    render();
  }

  function renderNotices(): HTMLElement[] {
    return notices.map((text, i) =>
      el(
        'div',
        { class: 'shopping-notice' },
        el('span', {}, text),
        button('btn btn-ghost btn-sm', 'dismiss', () => dismissNotice(i)),
      ),
    );
  }

  function renderGroups(currentList: ShoppingList): HTMLElement {
    const wrap = el('div', { class: 'shopping-groups' });
    const readOnly = currentList.status === 'done';
    for (const group of groupByAisle(currentList.items)) {
      const boughtInGroup = group.items.filter((i) => i.bought).length;
      wrap.appendChild(
        el(
          'div',
          { class: 'section-header shopping-group-header', style: `color: ${categoryColor(group.category)}` },
          el('span', {}, group.category),
          el('span', { class: 'row-meta' }, `${boughtInGroup}/${group.items.length}`),
        ),
      );
      for (const item of group.items) {
        wrap.appendChild(
          buildShoppingRow(item, readOnly, {
            onToggle: () => void toggleBought(item),
            onDelete: () => void removeRow(item),
          }),
        );
      }
    }
    return wrap;
  }

  function renderFirstRun(): void {
    bodyEl.replaceChildren(
      el(
        'div',
        { class: 'empty-state' },
        el('h1', {}, 'No shopping list yet'),
        el(
          'p',
          {},
          "This week doesn't have a shopping list. Generate one from the meal plan — needed minus what's already in the pantry.",
        ),
        button('btn btn-primary', "generate this week's list", () =>
          void runGenerate(isoToday(), { onGenerated: handleGenerated }),
        ),
      ),
    );
  }

  function renderEmpty(currentList: ShoppingList): void {
    bodyEl.replaceChildren(
      ...renderNotices(),
      el(
        'div',
        { class: 'empty-state' },
        el('h1', {}, 'Nothing to buy'),
        el(
          'p',
          {},
          "The week's plan needs nothing the pantry doesn't already have. Either you planned well, or the week is empty.",
        ),
        el(
          'div',
          { class: 'flex gap-2' },
          button('btn btn-primary', 'open the week', () => ctx.navigate('/plan')),
          // Regeneration is a draft-only operation (the API 409s otherwise), so
          // an emptied list that has moved on doesn't get offered a dead button.
          currentList.status === 'draft'
            ? button('btn btn-ghost', 'regenerate', () =>
                void runGenerate(currentList.weekStarting, { onGenerated: handleGenerated }, includeOptional),
              )
            : null,
        ),
      ),
    );
  }

  function render(): void {
    if (destroyed) return;
    if (!list) {
      renderFirstRun();
      return;
    }
    if (list.items.length === 0) {
      renderEmpty(list);
      return;
    }
    const headerHandlers: HeaderHandlers = {
      onGenerated: handleGenerated,
      onCompleted: handleCompleted,
      onItemCreated: handleItemCreated,
    };
    const headerState: HeaderState = {
      includeOptional,
      onToggleOptional: () => {
        includeOptional = !includeOptional;
        render();
      },
    };
    bodyEl.replaceChildren(
      buildShoppingHeader(list, headerHandlers, headerState),
      ...renderNotices(),
      renderGroups(list),
    );
  }

  async function loadCurrent(): Promise<void> {
    bodyEl.replaceChildren(loadingRow('loading shopping list…'));
    try {
      const row = await getCurrentShoppingList();
      if (destroyed) return;
      list = row;
      notices = [];
      render();
      updateSubtitle();
    } catch (e) {
      if (destroyed) return;
      if (isApiError(e) && e.status === 404) {
        list = null;
        render();
        updateSubtitle();
        return;
      }
      bodyEl.replaceChildren(errorPanel(userMessage(e), () => void loadCurrent()));
    }
  }

  return {
    title: 'Shopping list',
    subtitle: 'aisle order · needed minus pantry',
    async mount(root, screenCtx) {
      ctx = screenCtx;
      destroyed = false;
      list = null;
      notices = [];
      bodyEl = el('div', { class: 'shopping-body' });
      root.append(bodyEl);
      await loadCurrent();
    },
    unmount() {
      destroyed = true;
    },
  };
}
