// The seam other screens use: confirm → cook → feedback, or feedback standalone.

import { say } from '../ui/toast.js';
import { openCookConfirm } from './cook-confirm.js';
import { openFeedback } from './cook-feedback.js';
import type { MealPlanEntry, CookResult } from '../api/types.js';

export interface CookFlowOptions {
  entry: MealPlanEntry;
  /**
   * After a cook (and again after feedback), a skip, or an already-cooked
   * 409 — with the fresh entry, so the plan grid can refresh. Skip does not
   * open the feedback modal.
   */
  onCooked?: (result: CookResult) => void;
}

/** confirm → cook → feedback. Never re-opens if a modal is already up (openModal replaces). */
export function openCookFlow(opts: CookFlowOptions): void {
  const { entry, onCooked } = opts;

  openCookConfirm({
    entry,
    onCooked: (result) => {
      // Reconcile from the cook response, not the stale preview — the pantry may
      // have moved between the two, and this is the authoritative count.
      const count = result.deductions.length;
      say(`Cooked. ${count} items deducted.`);
      onCooked?.(result);
      openFeedback({
        entry: result.entry,
        title: `Cooked. ${count} items deducted.`,
        onDone: () => onCooked?.(result),
      });
    },
    onAlreadyCooked: () => {
      // Someone cooked this entry in another tab: nothing was deducted in this
      // session, so there's no real CookResult — synthesize just enough of one
      // (status flipped, no deduction detail) to tell the caller to re-render.
      say('Already cooked.', 'error');
      onCooked?.({
        entry: { ...entry, status: 'cooked' },
        deductions: [],
        shortfalls: [],
      });
    },
    onSkipped: (skipped) => {
      // Same refresh path as a cook so the grid cannot stay on `planned`.
      onCooked?.({ entry: skipped, deductions: [], shortfalls: [] });
    },
  });
}

/** Rate an already-cooked entry — the Today screen's `rate` button uses this directly. */
export function openFeedbackModal(entry: MealPlanEntry): void {
  openFeedback({ entry, title: 'Cook feedback' });
}
