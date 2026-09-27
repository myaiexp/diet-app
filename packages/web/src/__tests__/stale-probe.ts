// Stale-guard probe: hold a screen's request, flip the mount stale (or not), release, report what it wrote.
//
// Every stale suite runs each case twice. Fresh is the control: it proves the
// path really writes (DOM, subtitle, toast) and that `settleWith`'s wait is
// long enough for it to — without that, a "wrote nothing" result on the stale
// run would pass for a guard that was never reached.

import { vi } from 'vitest';
import { clearToast } from '../ui/toast.js';
import { deferred, flush, makeCtx, watchMutations } from './harness.js';

export type TestCtx = ReturnType<typeof makeCtx>;

export interface Held<T> {
  /** Pass as a `routeFetch` handler — the request stays pending until released. */
  handler: () => Promise<T>;
  /** Resolves once the screen has actually sent the request. */
  requested(): Promise<void>;
  resolve(value: T): void;
}

export function hold<T>(): Held<T> {
  const gate = deferred<T>();
  let sent = false;
  return {
    handler: () => {
      sent = true;
      return gate.promise;
    },
    requested: () =>
      vi.waitFor(() => {
        if (!sent) throw new Error('request not sent yet');
      }),
    resolve: gate.resolve,
  };
}

export interface Written {
  /** Any DOM mutation under the screen root. */
  dom: boolean;
  subtitle: boolean;
  /** Kind of the toast showing afterwards (`error`, `warning`, `success`), or null. */
  toast: string | null;
}

export async function settleWith(
  root: HTMLElement,
  ctx: TestCtx,
  stale: boolean,
  release: () => void,
): Promise<Written> {
  ctx.setStale(stale);
  ctx.setSubtitle.mockClear();
  clearToast();
  const stop = watchMutations(root);
  release();
  // Response body parsing and the screen's continuation span a few ticks;
  // the fresh control run is what shows this is enough.
  for (let i = 0; i < 3; i++) await flush();
  const toast = document.querySelector('.toast');
  return {
    dom: stop() > 0,
    subtitle: ctx.setSubtitle.mock.calls.length > 0,
    toast: toast ? (toast.className.match(/toast-(\w+)/)?.[1] ?? 'unknown') : null,
  };
}

export const FRESH_THEN_STALE = [
  { mode: 'fresh', stale: false },
  { mode: 'stale', stale: true },
] as const;
