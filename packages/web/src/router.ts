// History routing: path → screen module, rendered into the shell's content pane

import { activeShell } from './ui/shell.js';
import { closeModal } from './ui/modal.js';
import { placeholderScreen } from './ui/placeholder.js';
import { pantryScreen } from './screens/pantry.js';
import { recipesScreen } from './screens/recipes.js';
import { importScreen } from './screens/import.js';
import { planScreen } from './screens/plan.js';
import { profileScreen } from './screens/profile.js';

export const ROUTES = [
  '/today',
  '/pantry',
  '/recipes',
  '/import',
  '/plan',
  '/profile',
  '/shopping',
  '/suggest',
  '/nutrition',
  '/waste',
] as const;

export type Route = (typeof ROUTES)[number];

export const DEFAULT_ROUTE: Route = '/today';

export interface ScreenContext {
  /** Update the header bar's subtitle once data has loaded. */
  setSubtitle(text: string): void;
  navigate(to: Route): void;
}

export interface Screen {
  title: string;
  subtitle?: string;
  /** `root` arrives empty. May be async — render your own loading state. */
  mount(root: HTMLElement, ctx: ScreenContext): void | Promise<void>;
  unmount?(): void;
}

export type ScreenFactory = () => Screen;

/**
 * Out-of-scope screens render a shared placeholder rather than a broken screen:
 * shopping-list generation, AI suggestions (#380), nutrition (#385) and waste
 * (#389) have no endpoint yet, and the nav must still be complete.
 */
const SCREENS: Record<Route, ScreenFactory> = {
  '/today': () =>
    placeholderScreen({
      title: 'Today',
      subtitle: 'what now',
      what: 'The day\'s four slots, what is spoiling, and the next action.',
      blocker: 'Screen under construction.',
    }),
  '/pantry': pantryScreen,
  '/recipes': recipesScreen,
  '/import': importScreen,
  '/plan': planScreen,
  '/profile': profileScreen,
  '/shopping': () =>
    placeholderScreen({
      title: 'Shopping list',
      subtitle: 'aisle order · needed minus pantry',
      what: 'A week\'s plan minus the pantry, grouped in aisle order and checked off one-handed in the shop.',
      blocker: 'GET /api/shopping-lists/current returns a stub — list generation is still being built.',
    }),
  '/suggest': () =>
    placeholderScreen({
      title: 'AI suggestions',
      subtitle: 'spoilage-weighted, explained',
      what: 'Recipe suggestions per empty slot, weighted toward food about to spoil, each explaining itself.',
      blocker: 'No endpoint yet — roadmap #380. Until it lands, fill slots from the meal plan grid.',
      cta: { label: 'open the week →', route: '/plan' },
    }),
  '/nutrition': () =>
    placeholderScreen({
      title: 'Nutrition',
      subtitle: 'vs the calorie target',
      what: 'Per-day kcal and macros against the profile target, planned days only.',
      blocker: 'No endpoint yet — roadmap #385.',
    }),
  '/waste': () =>
    placeholderScreen({
      title: 'Waste',
      subtitle: 'what expired unused',
      what: 'What expired before it was cooked, the trend, and the pattern behind it.',
      blocker: 'No endpoint yet — roadmap #389.',
    }),
};

let mountPoint: HTMLElement | null = null;
let currentScreen: Screen | null = null;
/** Bumped per render so a slow async mount can't paint over a newer screen. */
let renderToken = 0;

export function currentRoute(): Route {
  return normalize(window.location.pathname);
}

function normalize(path: string): Route {
  const clean = path.replace(/\/+$/, '') || '/';
  return (ROUTES as readonly string[]).includes(clean)
    ? (clean as Route)
    : DEFAULT_ROUTE;
}

async function render(route: Route): Promise<void> {
  if (!mountPoint) return;
  const token = ++renderToken;

  currentScreen?.unmount?.();
  const screen = SCREENS[route]();
  currentScreen = screen;

  const shell = activeShell();
  shell?.setActive(route);
  shell?.setTitle(screen.title, screen.subtitle ?? '');

  mountPoint.replaceChildren();
  mountPoint.scrollTop = 0;

  const ctx: ScreenContext = {
    setSubtitle: (text) => {
      // A screen that finished loading after the user moved on must not
      // relabel the header of the screen they are now looking at.
      if (token === renderToken) activeShell()?.setTitle(screen.title, text);
    },
    navigate,
  };

  await screen.mount(mountPoint, ctx);
}

export function navigate(to: Route): void {
  // Changing screen closes any open modal — a modal belongs to the screen
  // that opened it, and leaving it up over a different screen is a lie.
  closeModal();
  const target = normalize(to);
  if (window.location.pathname !== target) {
    window.history.pushState({}, '', target);
  }
  void render(target);
}

export function startRouter(mount: HTMLElement): void {
  mountPoint = mount;
  window.addEventListener('popstate', () => {
    closeModal();
    void render(currentRoute());
  });

  const route = currentRoute();
  // Normalize an unknown path in the address bar too, not just in the view.
  if (window.location.pathname !== route) {
    window.history.replaceState({}, '', route);
  }
  void render(route);
}
