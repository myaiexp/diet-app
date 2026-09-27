// The seam other screens use: confirm → cook → feedback, or feedback standalone.

import { say } from '../ui/toast.js';
import { openCookConfirm } from './cook-confirm.js';
import { openFeedback } from './cook-feedback.js';
import type { MealPlanEntry } from '../api/types.js';

export interface CookFlowOptions {
  entry: MealPlanEntry;
  /** Whenever the flow changes the entry's status (cooked, skipped, or found already cooked) — re-render it. */
  onEntryChanged?: (entry: MealPlanEntry) => void;
}

/** confirm → cook → feedback. Never re-opens if a modal is already up (openModal replaces). */
export function openCookFlow(opts: CookFlowOptions): void {
  const { entry, onEntryChanged } = opts;

  openCookConfirm({
    entry,
    onCooked: (result) => {
      // Reconcile from the cook response, not the stale preview — the pantry may
      // have moved between the two, and this is the authoritative count.
      const count = result.deductions.length;
      say(`Cooked. ${count} items deducted.`);
      onEntryChanged?.(result.entry);
      openFeedback({
        entry: result.entry,
        title: `Cooked. ${count} items deducted.`,
        onDone: () => onEntryChanged?.(result.entry),
      });
    },
    onAlreadyCooked: () => {
      // Someone cooked this entry in another tab. The 409 carries no entry, so
      // flip the status locally to stop the caller offering cook again.
      say('Already cooked.', 'error');
      onEntryChanged?.({ ...entry, status: 'cooked' });
    },
    onSkipped: (skipped) => onEntryChanged?.(skipped),
  });
}

/** Rate an already-cooked entry — the Today screen's `rate` button uses this directly. */
export function openFeedbackModal(entry: MealPlanEntry): void {
  openFeedback({ entry, title: 'Cook feedback' });
}
