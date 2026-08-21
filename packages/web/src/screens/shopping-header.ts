// Sticky header: bought/total + progress meter + provenance + regenerate /
// complete / add actions, and the complete-confirm modal — the one
// destructive action on this screen, so it gets a confirm like cook does.

import type {
  ShoppingList,
  ShoppingItem,
  ShoppingListStatus,
  SkippedGenerateLine,
  SkippedCompleteItem,
} from '../api/types.js';
import { generateShoppingList, completeShoppingList } from '../api/shopping.js';
import { userMessage } from '../api/errors.js';
import { toNumber } from '../format/quantity.js';
import { isoWeekNumber } from '../format/date.js';
import { el, button } from '../ui/dom.js';
import { openModal, closeModal } from '../ui/modal.js';
import { say } from '../ui/toast.js';
import { openAddShoppingItemModal } from './shopping-add.js';

export interface HeaderHandlers {
  onGenerated: (list: ShoppingList, skipped: SkippedGenerateLine[]) => void;
  onCompleted: (list: ShoppingList, skipped: SkippedCompleteItem[]) => void;
  onItemCreated: (item: ShoppingItem) => void;
}

function regenerateUnavailableReason(status: ShoppingListStatus): string {
  return status === 'done'
    ? 'completed — regeneration is not offered on a finished list'
    : 'already being shopped — regeneration is not offered mid-shop';
}

/**
 * Shared by the header's `regenerate` button, the empty state's, and the
 * first-run generate. The wording stays "generated" for all three: the first
 * run genuinely isn't a regeneration, and one honest verb beats a branch.
 */
export async function runGenerate(
  weekStarting: string,
  handlers: Pick<HeaderHandlers, 'onGenerated'>,
  includeOptional = false,
): Promise<void> {
  try {
    const result = await generateShoppingList(weekStarting, includeOptional);
    say('Shopping list generated.', 'success');
    handlers.onGenerated({ ...result.list, items: result.items }, result.skipped);
  } catch (e) {
    say(userMessage(e), 'error');
  }
}

function openCompleteConfirm(list: ShoppingList, handlers: HeaderHandlers): void {
  // Only bought items with something actually left to buy get filed — a
  // bought row that the pantry already fully covered (netToBuy 0) files
  // nothing, so naming *that* count is what makes the confirm honest.
  const filing = list.items.filter((i) => i.bought && toNumber(i.netToBuy) > 0).length;
  const body = el(
    'p',
    { class: 'text-pretty' },
    `${filing} item${filing === 1 ? '' : 's'} will be filed into the pantry. This can't be undone.`,
  );
  const footer = el(
    'div',
    { class: 'flex gap-2' },
    button('btn btn-ghost', 'cancel', () => closeModal()),
    button('btn btn-primary', 'complete', () => void commit()),
  );

  async function commit(): Promise<void> {
    try {
      const result = await completeShoppingList(list.id);
      closeModal();
      say('Shopping list completed.', 'success');
      handlers.onCompleted({ ...list, ...result.list }, result.skipped);
    } catch (e) {
      say(userMessage(e), 'error');
    }
  }

  openModal({ title: 'Complete shopping list', body, footer, width: 380 });
}

export interface HeaderState {
  /** Opt the recipes' optional lines into the next generate. Screen-held, not
   * persisted: the API takes it per request, so it applies to this shop only. */
  includeOptional: boolean;
  onToggleOptional: () => void;
}

export function buildShoppingHeader(
  list: ShoppingList,
  handlers: HeaderHandlers,
  state: HeaderState,
): HTMLElement {
  const total = list.items.length;
  const boughtCount = list.items.filter((i) => i.bought).length;
  const pct = total === 0 ? 0 : Math.round((boughtCount / total) * 100);

  const meterFill = el('div', { class: 'shopping-meter-fill', style: `width:${pct}%` });

  const actions = el('div', { class: 'flex gap-2 shopping-actions' });
  if (list.status === 'draft') {
    const optionalChip = button(
      `chip${state.includeOptional ? ' is-on' : ''}`,
      'include optional',
      state.onToggleOptional,
      // String, not boolean — el() drops a `false` attribute entirely.
      { 'aria-pressed': String(state.includeOptional) },
    );
    actions.append(
      optionalChip,
      button('btn btn-ghost btn-sm', 'regenerate', () =>
        void runGenerate(list.weekStarting, handlers, state.includeOptional),
      ),
    );
  } else {
    actions.appendChild(el('span', { class: 'helper' }, regenerateUnavailableReason(list.status)));
  }
  if (list.status !== 'done' && boughtCount > 0) {
    actions.appendChild(
      button('btn btn-primary btn-sm', 'complete', () => openCompleteConfirm(list, handlers)),
    );
  }
  if (list.status !== 'done') {
    actions.appendChild(
      button('btn btn-primary btn-sm', '+ add', () =>
        openAddShoppingItemModal(list.id, { onCreated: handlers.onItemCreated }),
      ),
    );
  }

  return el(
    'div',
    { class: 'bar-sticky shopping-header' },
    el('div', { class: 'shopping-count' }, `${boughtCount} / ${total} bought`),
    el('div', { class: 'shopping-meter' }, meterFill),
    el(
      'div',
      { class: 'row-meta' },
      `from vk ${isoWeekNumber(list.weekStarting)} plan · minus pantry · aisle order`,
    ),
    list.status === 'done'
      ? el('div', { class: 'shopping-readonly-note' }, 'completed — read-only')
      : null,
    actions,
  );
}
