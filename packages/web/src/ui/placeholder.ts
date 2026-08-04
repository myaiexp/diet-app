// "Not built yet" screen — honest about what is missing and why

import type { Route, Screen } from '../router.js';
import { el } from './dom.js';

export interface PlaceholderSpec {
  title: string;
  subtitle: string;
  /** What the screen will do, in one sentence. */
  what: string;
  /** Why it is not here — the missing endpoint or roadmap item. */
  blocker: string;
  /** Optional link to the screen that does the job today. */
  cta?: { label: string; route: Route };
}

export function placeholderScreen(spec: PlaceholderSpec): Screen {
  return {
    title: spec.title,
    subtitle: spec.subtitle,
    mount(root, ctx) {
      const panel = el('div', { class: 'placeholder' });
      panel.append(
        el('h1', {}, spec.title),
        el('p', { class: 'placeholder-what' }, spec.what),
        el('p', { class: 'helper' }, spec.blocker),
      );
      if (spec.cta) {
        const cta = spec.cta;
        const btn = el('button', { class: 'btn btn-primary' }, cta.label);
        btn.addEventListener('click', () => ctx.navigate(cta.route));
        panel.appendChild(btn);
      }
      root.appendChild(panel);
    },
  };
}
