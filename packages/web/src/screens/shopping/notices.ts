// Human-readable summaries for the two `skipped` arrays the API returns —
// generate's per-recipe-line skips and complete's per-item pantry-file skips.
// Neither is swallowed: both become a dismissible notice on the shopping screen.

import type { SkippedGenerateLine, SkippedCompleteItem } from '../../api/types.js';

const REASON_LABEL: Record<SkippedGenerateLine['reason'], string> = {
  unknown_unit: 'unknown unit',
  recipe_missing: 'recipe missing',
  bad_scale: 'bad scale',
};

/** e.g. "3 recipe lines were skipped — unknown unit; 1 recipe line was skipped — recipe missing" */
export function describeSkippedGenerate(skipped: SkippedGenerateLine[]): string {
  const counts = new Map<SkippedGenerateLine['reason'], number>();
  for (const s of skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  return [...counts.entries()]
    .map(
      ([reason, n]) =>
        `${n} recipe line${n === 1 ? ' was' : 's were'} skipped — ${REASON_LABEL[reason]}`,
    )
    .join('; ');
}

/**
 * e.g. "2 items did not reach the pantry — no shelf life on record for where
 * they were filed. Add them by hand."
 *
 * These items were **not** written: `/complete` skips an item whose ingredient
 * has no shelf life for its resolved location rather than guessing an expiry
 * date. Saying anything that implies they landed would send the user looking
 * for food the pantry does not have.
 */
export function describeSkippedComplete(skipped: SkippedCompleteItem[]): string {
  const n = skipped.length;
  return (
    `${n} item${n === 1 ? '' : 's'} did not reach the pantry — no shelf life on record ` +
    `for where ${n === 1 ? 'it' : 'they'} would be stored. Add ${n === 1 ? 'it' : 'them'} by hand.`
  );
}
