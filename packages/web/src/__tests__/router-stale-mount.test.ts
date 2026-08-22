// Router must ignore a stale async mount: a slow screen that writes after
// navigation must not paint over the screen the user is now looking at.
//
// The fixture deliberately has no unmount/isStale guard — that is the
// screen discipline the router is not allowed to rely on. Screens share
// loadInto + ctx.isStale(); this test pins the router's own pane swap,
// which still has to hold even if a screen paints after await.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeModal } from '../ui/modal.js';

const { gate, captured } = vi.hoisted(() => {
  const gate: { promise: Promise<void>; release: () => void } = {
    promise: Promise.resolve(),
    release: () => {},
  };
  const captured: { isStale: (() => boolean) | null } = { isStale: null };
  return { gate, captured };
});

vi.mock('../screens/today/index.js', () => ({
  todayScreen: () => ({
    title: 'Today',
    async mount(root: HTMLElement, ctx: { isStale: () => boolean }) {
      captured.isStale = ctx.isStale;
      await gate.promise;
      const marker = document.createElement('div');
      marker.className = 'stale-today';
      marker.textContent = 'STALE-TODAY';
      root.replaceChildren(marker);
    },
  }),
}));

import { mountShell } from '../ui/shell.js';
import { startRouter, navigate } from '../router.js';
import { flush } from './harness.js';

function boot(path = '/today') {
  window.history.replaceState({}, '', path);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const shell = mountShell(root, navigate);
  startRouter(shell.content);
  return { root, shell };
}

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
  captured.isStale = null;
  gate.promise = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
});

afterEach(() => closeModal());

describe('router stale mount', () => {
  test('a held mount that resolves after navigation leaves the new screen in the pane', async () => {
    const { shell } = boot('/today');
    navigate('/nutrition');
    expect(shell.content.querySelector('.placeholder')).not.toBeNull();
    expect(shell.content.textContent).toContain('#385');

    gate.release();
    await flush(20);

    expect(shell.content.querySelector('.placeholder')).not.toBeNull();
    expect(shell.content.textContent).toContain('#385');
    expect(shell.content.querySelector('.stale-today')).toBeNull();
    expect(shell.content.textContent).not.toContain('STALE-TODAY');
  });

  test('ctx.isStale is false during the active mount and true after navigation', async () => {
    boot('/today');
    await flush(0);
    expect(captured.isStale).not.toBeNull();
    expect(captured.isStale!()).toBe(false);

    navigate('/nutrition');
    expect(captured.isStale!()).toBe(true);

    gate.release();
    await flush(20);
  });
});
