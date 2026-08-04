// App shell: sidebar (desktop) / bottom tab bar (phone) + screen header bar

import type { Route } from '../router.js';
import { el, button } from './dom.js';
import { finnishWeekdayLong, finnishDate, isoToday } from '../format/date.js';

interface NavItem {
  route: Route;
  glyph: string;
  label: string;
  group: 'plan' | 'review';
  /** Also a bottom tab on phone, with this shorter label. */
  tab?: string;
}

// Geometric unicode, not icons — the design's own choice.
const NAV: NavItem[] = [
  { route: '/today', glyph: '◆', label: 'Today', group: 'plan', tab: 'Today' },
  { route: '/pantry', glyph: '▤', label: 'Pantry', group: 'plan', tab: 'Pantry' },
  { route: '/plan', glyph: '▦', label: 'Meal plan', group: 'plan', tab: 'Plan' },
  { route: '/suggest', glyph: '✳', label: 'Suggestions', group: 'plan' },
  { route: '/shopping', glyph: '▣', label: 'Shopping', group: 'plan', tab: 'Shop' },
  { route: '/recipes', glyph: '▧', label: 'Recipes', group: 'review' },
  { route: '/import', glyph: '↓', label: 'Import', group: 'review' },
  { route: '/nutrition', glyph: '▪', label: 'Nutrition', group: 'review' },
  { route: '/waste', glyph: '▫', label: 'Waste', group: 'review' },
  { route: '/profile', glyph: '◍', label: 'Profile', group: 'review' },
];

export interface Shell {
  /** Where screens mount — the single scroll region of the main pane. */
  content: HTMLElement;
  setTitle(title: string, subtitle?: string): void;
  setActive(route: Route): void;
  /** Count badge on a nav entry; null clears it. */
  setBadge(route: Route, text: string | null, tone?: 'red' | 'orange' | 'accent'): void;
  setFooter(primary: string, secondary: string): void;
}

let current: Shell | null = null;

/** The mounted shell, or null in a test that renders a screen bare. */
export function activeShell(): Shell | null {
  return current;
}

function navButton(item: NavItem, onNavigate: (r: Route) => void): HTMLElement {
  const btn = button('nav-item', '', () => onNavigate(item.route), {
    'data-route': item.route,
  });
  btn.append(
    el('span', { class: 'nav-glyph' }, item.glyph),
    el('span', { class: 'nav-label' }, item.label),
    el('span', { class: 'nav-badge hidden' }),
  );
  return btn;
}

function tabButton(item: NavItem, onNavigate: (r: Route) => void): HTMLElement {
  const btn = button('tab-item', '', () => onNavigate(item.route), {
    'data-route': item.route,
  });
  btn.append(
    el('span', { class: 'tab-glyph' }, item.glyph),
    el('span', { class: 'tab-label' }, item.tab ?? item.label),
  );
  return btn;
}

export function mountShell(root: HTMLElement, onNavigate: (r: Route) => void): Shell {
  root.replaceChildren();
  root.classList.add('app-shell');

  // --- sidebar (desktop) ---
  const navList = el('div', { class: 'scroll-region nav-list' });
  for (const group of ['plan', 'review'] as const) {
    navList.appendChild(el('div', { class: 'section-header' }, group));
    for (const item of NAV.filter((n) => n.group === group)) {
      navList.appendChild(navButton(item, onNavigate));
    }
  }
  const footPrimary = el('div', {}, '');
  const footSecondary = el('div', {}, '');
  const sidebar = el(
    'nav',
    { class: 'pane sidebar' },
    navList,
    el('div', { class: 'pane-bar sidebar-foot' }, footPrimary, footSecondary),
  );

  // --- screen header bar ---
  const titleEl = el('span', { class: 'screen-title' }, '');
  const subtitleEl = el('span', { class: 'screen-sub' }, '');
  const today = isoToday();
  const headerBar = el(
    'header',
    { class: 'pane-bar screen-bar' },
    el('div', { class: 'flex items-center gap-3 min-w-0' }, titleEl, subtitleEl),
    el(
      'div',
      { class: 'flex items-center gap-3' },
      el('span', { class: 'status status-running' }, 'api'),
      el('span', { class: 'screen-date' }, `${finnishWeekdayLong(today)} ${finnishDate(today)}`),
    ),
  );

  const content = el('main', { class: 'scroll-region screen' });
  const mainPane = el('div', { class: 'pane shell-main' }, headerBar, content);

  // --- bottom tab bar (phone) ---
  const tabs = NAV.filter((n) => n.tab);
  const moreSheet = el('div', { class: 'more-sheet hidden' });
  for (const item of NAV.filter((n) => !n.tab)) {
    const row = button('more-row', '', () => {
      moreSheet.classList.add('hidden');
      onNavigate(item.route);
    });
    row.append(
      el('span', { class: 'nav-glyph' }, item.glyph),
      el('span', {}, item.label),
    );
    moreSheet.appendChild(row);
  }
  const moreBtn = button('tab-item', '', () =>
    moreSheet.classList.toggle('hidden'),
  );
  moreBtn.append(
    el('span', { class: 'tab-glyph' }, '⋯'),
    el('span', { class: 'tab-label' }, 'More'),
  );
  const tabbar = el(
    'nav',
    { class: 'pane-bar tabbar' },
    ...tabs.map((item) => tabButton(item, onNavigate)),
    moreBtn,
  );

  root.append(el('div', { class: 'pane-row shell-row' }, sidebar, mainPane), moreSheet, tabbar);

  const shell: Shell = {
    content,
    setTitle(title, subtitle = '') {
      titleEl.textContent = title;
      subtitleEl.textContent = subtitle;
      document.title = title === 'Today' ? 'Ruoka' : `Ruoka · ${title}`;
    },
    setActive(route) {
      // The More sheet belongs to the tab that opened it; any navigation ends it.
      moreSheet.classList.add('hidden');
      for (const btn of root.querySelectorAll<HTMLElement>('[data-route]')) {
        btn.classList.toggle('is-active', btn.dataset['route'] === route);
      }
    },
    setBadge(route, text, tone = 'accent') {
      for (const btn of root.querySelectorAll<HTMLElement>(
        `.nav-item[data-route="${route}"]`,
      )) {
        const badge = btn.querySelector<HTMLElement>('.nav-badge');
        if (!badge) continue;
        badge.textContent = text ?? '';
        badge.className = `nav-badge label label-${tone}`;
        badge.classList.toggle('hidden', text === null);
      }
    },
    setFooter(primary, secondary) {
      footPrimary.textContent = primary;
      footSecondary.textContent = secondary;
    },
  };

  current = shell;
  return shell;
}
