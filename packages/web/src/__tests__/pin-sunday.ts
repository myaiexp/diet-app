// Pin screen-suite Date to Sunday 2026-08-09 noon UTC.

import { afterEach, beforeEach, vi } from 'vitest';

/** Sunday, so mondayOf closes the week. Noon UTC, so a wait cannot cross midnight. */
export function pinSunday(): void {
  // Date only. Faking setTimeout would change vi.waitFor and AbortSignal.timeout;
  // those stay on the real clock (docs/testing.md).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-09T12:00:00.000Z'));
}

// Module body runs before the suite's `const TODAY = isoToday()`, so the
// fixture and the screen share one Sunday. beforeEach re-pins in case a
// test restored timers.
pinSunday();
beforeEach(pinSunday);
afterEach(() => {
  vi.useRealTimers();
});
