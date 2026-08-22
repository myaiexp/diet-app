// Shared async-mount: loading row, retry panel, stale-guard

import { userMessage } from '../api/errors.js';
import { errorPanel, loadingRow } from './dom.js';

export interface LoadIntoOptions<T> {
  container: HTMLElement;
  label: string;
  isStale: () => boolean;
  load: () => Promise<T>;
  render: (data: T) => void | Promise<void>;
  formatError?: (err: unknown) => string;
  /** Return true if the error was handled (skip the default retry panel). */
  onError?: (err: unknown, retry: () => void) => boolean | void;
}

/**
 * Paint a loading row, run `load`, then `render`. A stale mount (navigated
 * away, or a newer call for the same pane) is a no-op after the await.
 * Failures become a retry-wired error panel unless `onError` claims them.
 */
export async function loadInto<T>(opts: LoadIntoOptions<T>): Promise<void> {
  const retry = (): void => {
    void loadInto(opts);
  };
  opts.container.replaceChildren(loadingRow(opts.label));
  try {
    const data = await opts.load();
    if (opts.isStale()) return;
    await opts.render(data);
  } catch (err) {
    if (opts.isStale()) return;
    if (opts.onError?.(err, retry)) return;
    opts.container.replaceChildren(
      errorPanel(opts.formatError?.(err) ?? userMessage(err), retry),
    );
  }
}
