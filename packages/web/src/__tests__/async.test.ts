// loadInto owns loading / error-retry / stale-guard so screens don't each re-derive it

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { loadInto } from '../ui/async.js';
import { ApiError } from '../api/errors.js';

function container(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('loadInto', () => {
  test('paints the loading row, then the render output', async () => {
    const root = container();
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    const done = loadInto({
      container: root,
      label: 'loading pantry…',
      isStale: () => false,
      load: () => pending,
      render: (data) => {
        root.replaceChildren(document.createTextNode(data));
      },
    });
    expect(root.querySelector('.loading')).not.toBeNull();
    expect(root.textContent).toBe('loading pantry…');
    resolve('ok');
    await done;
    expect(root.textContent).toBe('ok');
  });

  test('on failure paints a retry-wired error panel and retry re-invokes load', async () => {
    const root = container();
    let calls = 0;
    await loadInto({
      container: root,
      label: 'loading…',
      isStale: () => false,
      load: async () => {
        calls += 1;
        if (calls === 1) throw new ApiError(500, { error: 'boom' });
        return 'recovered';
      },
      render: (data) => {
        root.replaceChildren(document.createTextNode(data));
      },
    });
    expect(root.querySelector('.error-panel')).not.toBeNull();
    expect(root.textContent).toMatch(/unexpected error/i);
    root.querySelector<HTMLButtonElement>('.btn')!.click();
    await vi.waitFor(() => expect(root.textContent).toBe('recovered'));
    expect(calls).toBe(2);
  });

  test('does not render when isStale after a successful load', async () => {
    const root = container();
    let stale = false;
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((r) => {
      resolve = r;
    });
    const done = loadInto({
      container: root,
      label: 'loading…',
      isStale: () => stale,
      load: () => pending,
      render: () => {
        root.replaceChildren(document.createTextNode('RENDERED'));
      },
    });
    stale = true;
    resolve('late');
    await done;
    expect(root.textContent).toBe('loading…');
    expect(root.textContent).not.toContain('RENDERED');
  });

  test('does not paint the error panel when isStale after a failed load', async () => {
    const root = container();
    let stale = false;
    let reject!: (err: unknown) => void;
    const pending = new Promise<string>((_, rej) => {
      reject = rej;
    });
    const done = loadInto({
      container: root,
      label: 'loading…',
      isStale: () => stale,
      load: () => pending,
      render: () => {
        root.replaceChildren(document.createTextNode('RENDERED'));
      },
    });
    stale = true;
    reject(new ApiError(500, { error: 'boom' }));
    await done;
    expect(root.querySelector('.error-panel')).toBeNull();
    expect(root.textContent).toBe('loading…');
  });

  test('onError returning true skips the default error panel', async () => {
    const root = container();
    await loadInto({
      container: root,
      label: 'loading…',
      isStale: () => false,
      load: async () => {
        throw new ApiError(404, { error: 'missing' });
      },
      render: () => {
        root.replaceChildren(document.createTextNode('RENDERED'));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 404) {
          root.replaceChildren(document.createTextNode('empty'));
          return true;
        }
      },
    });
    expect(root.textContent).toBe('empty');
    expect(root.querySelector('.error-panel')).toBeNull();
  });

  test('formatError customises the default panel message', async () => {
    const root = container();
    await loadInto({
      container: root,
      label: 'loading…',
      isStale: () => false,
      load: async () => {
        throw new ApiError(400, { error: 'bad' });
      },
      render: () => undefined,
      formatError: (err) => `custom ${err instanceof Error ? err.message : ''}`,
    });
    expect(root.querySelector('.error-panel')?.textContent).toContain('custom bad');
  });
});
