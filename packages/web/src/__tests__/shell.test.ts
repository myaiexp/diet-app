// App shell + router: nav, active state, modal teardown, unknown-path fallback

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mountShell, activeShell } from '../ui/shell.js';
import { startRouter, navigate, currentRoute, ROUTES } from '../router.js';
import { openModal, isModalOpen, closeModal } from '../ui/modal.js';
import { el } from '../ui/dom.js';

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
});

afterEach(() => closeModal());

describe('shell', () => {
  test('renders one nav entry per route, in two groups', () => {
    const { root } = boot();
    const items = root.querySelectorAll('.nav-item');
    expect(items).toHaveLength(ROUTES.length);
    expect([...root.querySelectorAll('.section-header')].map((n) => n.textContent)).toEqual([
      'plan',
      'review',
    ]);
  });

  test('marks the current route active in both nav surfaces', () => {
    const { root } = boot('/pantry');
    const active = [...root.querySelectorAll<HTMLElement>('.is-active')];
    expect(active.length).toBeGreaterThan(0);
    for (const node of active) expect(node.dataset['route']).toBe('/pantry');
  });

  test('clicking a nav item routes there', () => {
    const { root } = boot();
    root.querySelector<HTMLElement>('.nav-item[data-route="/recipes"]')!.click();
    expect(currentRoute()).toBe('/recipes');
    expect(window.location.pathname).toBe('/recipes');
  });

  test('offers a phone tab bar with the five phone-first surfaces plus More', () => {
    const { root } = boot();
    const tabs = [...root.querySelectorAll<HTMLElement>('.tab-item')];
    expect(tabs.map((t) => t.dataset['route'] ?? 'more')).toEqual([
      '/today',
      '/pantry',
      '/plan',
      '/shopping',
      'more',
    ]);
  });

  test('the More sheet lists every non-tab screen and closes on navigation', () => {
    const { root } = boot();
    const sheet = root.parentElement!.querySelector<HTMLElement>('.more-sheet')!;
    expect(sheet.querySelectorAll('.more-row')).toHaveLength(ROUTES.length - 4);
    root.querySelectorAll<HTMLElement>('.tab-item')[4]!.click();
    expect(sheet.classList.contains('hidden')).toBe(false);
    sheet.querySelector<HTMLElement>('.more-row')!.click();
    expect(sheet.classList.contains('hidden')).toBe(true);
  });

  test('setBadge writes and clears a count on a nav entry', () => {
    const { root, shell } = boot();
    shell.setBadge('/pantry', '1', 'red');
    const badge = root.querySelector<HTMLElement>('.nav-item[data-route="/pantry"] .nav-badge')!;
    expect(badge.textContent).toBe('1');
    expect(badge.classList.contains('label-red')).toBe(true);
    shell.setBadge('/pantry', null);
    expect(badge.classList.contains('hidden')).toBe(true);
  });

  test('exactly one scroll region per pane, none nested', () => {
    const { root } = boot();
    const regions = [...root.querySelectorAll('.scroll-region')];
    expect(regions).toHaveLength(2); // sidebar nav list + screen content
    for (const region of regions) {
      expect(region.querySelector('.scroll-region')).toBeNull();
    }
  });
});

describe('router', () => {
  test('an unknown path falls back to /today', () => {
    const { root } = boot('/nope');
    expect(currentRoute()).toBe('/today');
    expect(window.location.pathname).toBe('/today');
    // The header, not the screen body: Today loads its data asynchronously and
    // this suite stubs no network, so the body is legitimately a loading row.
    expect(root.querySelector('.screen-title')!.textContent).toBe('Today');
    expect(activeShell()!.content.children.length).toBeGreaterThan(0);
  });

  test('out-of-scope routes render the placeholder, not a broken screen', () => {
    const { shell } = boot();
    navigate('/nutrition');
    expect(shell.content.querySelector('.placeholder')).not.toBeNull();
    expect(shell.content.textContent).toContain('#385');
  });

  test('the placeholder CTA routes to the screen that does the job today', () => {
    const { shell } = boot();
    navigate('/suggest');
    shell.content.querySelector<HTMLElement>('.btn-primary')!.click();
    expect(currentRoute()).toBe('/plan');
  });

  test('navigate() closes an open modal', () => {
    boot();
    openModal({ title: 'Cook', body: el('div', {}, 'body') });
    expect(isModalOpen()).toBe(true);
    navigate('/pantry');
    expect(isModalOpen()).toBe(false);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
  });

  test('popstate closes an open modal and swaps the pane to the route in the address bar', async () => {
    const { shell } = boot('/nutrition');
    expect(shell.content.textContent).toContain('#385');
    openModal({ title: 'Cook', body: el('div', {}, 'confirm') });
    expect(isModalOpen()).toBe(true);

    // jsdom's history.back() does not fire popstate; dispatch the same event
    // the browser would, with the address bar already on the restored route.
    window.history.replaceState({}, '', '/waste');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(isModalOpen()).toBe(false);
    expect(document.querySelector('.modal-backdrop')).toBeNull();
    expect(currentRoute()).toBe('/waste');
    expect(shell.content.textContent).toContain('#389');
    expect(shell.content.textContent).not.toContain('#385');
  });

  test('the screen title lands in the header bar and updates on navigation', () => {
    const { root } = boot('/pantry');
    const title = root.querySelector('.screen-title')!;
    expect(title.textContent).toBe('Pantry');
    navigate('/profile');
    expect(title.textContent).toBe('Profile');
  });
});

describe('modal', () => {
  test('Escape closes, and focus returns to the opener', () => {
    boot();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    openModal({ title: 'X', body: el('div', {}, el('button', {}, 'ok')) });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isModalOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  test('opening a second modal replaces the first', () => {
    boot();
    openModal({ title: 'first', body: el('div', {}, 'a') });
    openModal({ title: 'second', body: el('div', {}, 'b') });
    expect(document.querySelectorAll('.modal-backdrop')).toHaveLength(1);
    expect(document.querySelector('.modal-title')!.textContent).toBe('second');
  });
});
