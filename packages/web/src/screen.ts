// Route list and the Screen contract — the types every screen and the shell share
//
// A leaf on purpose: no imports. router.ts imports every screen and the shell,
// so the types they need cannot live there without making each of them import
// the module that imports them.

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
  /** True once this mount has been superseded by another route. */
  isStale(): boolean;
}

export interface Screen {
  title: string;
  subtitle?: string;
  /** `root` arrives empty. May be async — render your own loading state. */
  mount(root: HTMLElement, ctx: ScreenContext): void | Promise<void>;
  unmount?(): void;
}

export type ScreenFactory = () => Screen;
