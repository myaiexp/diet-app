// Pin shopping-suite Date inside makeShoppingList's week (Mon 2026-08-17).

import { afterEach, beforeEach, vi } from 'vitest';

/** Wednesday of the fixture list's week, so the list reads as this week's. Noon
 * UTC, so a wait cannot cross midnight. An unpinned clock would make the
 * fixture an earlier week's list as soon as the real date passes it. */
export function pinFixtureWeek(): void {
  // Date only. Faking setTimeout would change vi.waitFor and AbortSignal.timeout;
  // those stay on the real clock (docs/testing.md).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-19T12:00:00.000Z'));
}

pinFixtureWeek();
beforeEach(pinFixtureWeek);
afterEach(() => {
  vi.useRealTimers();
});
