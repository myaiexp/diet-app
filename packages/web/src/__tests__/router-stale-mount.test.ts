// Router must ignore a stale async mount: a slow screen that writes after
// navigation must not paint over the screen the user is now looking at.
//
// The fixture deliberately has no unmount/destroyed guard — that is the
// screen discipline the router is not allowed to rely on. Recipes today is
// the production example (it `root.replaceChildren` after await with no
// check); Today/pantry/profile already no-op on unmount, so they would not
// pin this.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { closeModal } from '../ui/modal.js';

const { gate } = vi.hoisted(() => {
  const gate: { promise: Promise<void>; release: () => void } = {
    promise: Promise.resolve(),
    release: () => {},
  };
  return { gate };
});

vi.mock('../screens/today.js', () => ({
  todayScreen: () => ({
    title: 'Today',
    async mount(root: HTMLElement) {
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

function boot(path = '/today') {
  window.history.replaceState({}, '', path);
  const root = document.createElement('div');
  document.body.appendChild(root);
  const shell = mountShell(root, navigate);
  startRouter(shell.content);
  return { root, shell };
}

function flush(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  document.body.replaceChildren();
  closeModal();
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
});
