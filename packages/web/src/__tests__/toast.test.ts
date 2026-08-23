// Toast lifecycle: replace, timer dismiss, click-to-dismiss.
//
// say() comments that deriving dismissal from a lifecycle diff leaked a
// permanent toast in the prototype, so the timer lives in say() and
// clearToast() runs first. Screen suites assert copy but never the 2600ms
// dismiss, a second say() replacing the first, or click-to-dismiss.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { say, clearToast } from '../ui/toast.js';
import { flush } from './harness.js';

const DISMISS_MS = 2600;

beforeEach(() => {
  document.body.replaceChildren();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  clearToast();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('toast', () => {
  test('a second say() leaves one toast showing the new copy', () => {
    say('first');
    say('second', 'error');
    const toasts = document.querySelectorAll('.toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.textContent).toBe('second');
    expect(toasts[0]!.className).toContain('toast-error');
  });

  test('the node is gone after 2600ms and still present just before', async () => {
    say('hello');
    expect(document.querySelector('.toast')).not.toBeNull();
    await flush(DISMISS_MS - 1);
    expect(document.querySelector('.toast')).not.toBeNull();
    await flush(1);
    expect(document.querySelector('.toast')).toBeNull();
  });

  test('replacing resets the timer so the first toast cannot kill the second', async () => {
    say('first');
    await flush(DISMISS_MS / 2);
    say('second');
    await flush(DISMISS_MS / 2);
    expect(document.querySelector('.toast')?.textContent).toBe('second');
    await flush(DISMISS_MS / 2);
    expect(document.querySelector('.toast')).toBeNull();
  });

  test('click dismisses the toast immediately', () => {
    say('hello');
    document.querySelector<HTMLElement>('.toast')!.click();
    expect(document.querySelector('.toast')).toBeNull();
  });
});
