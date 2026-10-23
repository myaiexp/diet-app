// Notice shown when GET /current returns an earlier week's list: names that
// week and offers this week's generate, which nothing else on the screen can.

import type { ShoppingList } from '../../api/types.js';
import { isoToday, isoWeekNumber, mondayOf } from '../../format/date.js';
import { el, button } from '../../ui/dom.js';

/** The API returns an earlier week only while this week has no list; a list
 * from a week before today's ISO Monday is that carry-over. */
export function isEarlierWeek(list: ShoppingList, today: string = isoToday()): boolean {
  return list.weekStarting < mondayOf(today);
}

/** `onGenerate` receives today's date — the API snaps it to this week's Monday. */
export function buildCarryOverNotice(
  list: ShoppingList,
  onGenerate: (today: string) => void,
  today: string = isoToday(),
): HTMLElement {
  const thatWeek = isoWeekNumber(list.weekStarting);
  const thisWeek = isoWeekNumber(today);
  // Starting this week's list makes /current return it instead, so an open
  // carry-over drops off this screen — say so while its bought items can
  // still be filed.
  const text =
    list.status === 'done'
      ? `vk ${thatWeek}'s list is complete. vk ${thisWeek} has no list yet.`
      : `vk ${thatWeek}'s list is still open — complete it to file what you bought. Starting vk ${thisWeek}'s list hides this one.`;
  return el(
    'div',
    { class: 'shopping-notice shopping-carry-over' },
    el('span', {}, text),
    button('btn btn-primary', `generate vk ${thisWeek}'s list`, () => onGenerate(today)),
  );
}
