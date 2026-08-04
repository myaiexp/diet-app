// The expiry ramp — RENDER ONLY. `status` always comes from the API.

import type { PantryStatus } from '../api/types.js';

export type { PantryStatus };

export interface RampColor {
  /** Text/edge-bar color. */
  text: string;
  /** Badge tint background. */
  badge: string;
  /** Row background tint, or null when the row stays untinted. */
  row: string | null;
}

/**
 * The amber rung is the literal `#e8a308`, deliberately not `var(--accent)`:
 * this project re-themes the accent to cyan, and spoilage is the app's primary
 * colour language. A re-theme must not be able to disturb the ramp.
 */
const RAMP: Record<PantryStatus, RampColor> = {
  expired: {
    text: 'var(--red)',
    badge: 'var(--red-bg)',
    row: 'color-mix(in srgb, var(--red) 6%, transparent)',
  },
  use_today: {
    text: 'var(--orange)',
    badge: 'var(--orange-bg)',
    row: 'color-mix(in srgb, var(--orange) 5%, transparent)',
  },
  use_soon: {
    text: '#e8a308',
    badge: 'color-mix(in srgb, #e8a308 14%, transparent)',
    row: null,
  },
  fresh: {
    text: 'var(--green)',
    badge: 'color-mix(in srgb, var(--green) 12%, transparent)',
    row: null,
  },
};

export function rampColor(status: PantryStatus): RampColor {
  return RAMP[status] ?? RAMP.fresh;
}

const LABELS: Record<PantryStatus, string> = {
  expired: 'expired',
  use_today: 'use today',
  use_soon: 'use soon',
  fresh: 'fresh',
};

export function statusLabel(status: PantryStatus): string {
  return LABELS[status] ?? status;
}

/** Rank for "most urgent first" grouping. Never a substitute for API order. */
export const STATUS_ORDER: Record<PantryStatus, number> = {
  expired: 0,
  use_today: 1,
  use_soon: 2,
  fresh: 3,
};

/** Apply the ramp to a row element: 3px edge bar + optional background tint. */
export function applyRamp(el: HTMLElement, status: PantryStatus): void {
  const ramp = rampColor(status);
  el.style.borderLeft = `3px solid ${ramp.text}`;
  if (ramp.row) el.style.background = ramp.row;
}
