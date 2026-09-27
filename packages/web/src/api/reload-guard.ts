// Bounds the 401 → reload response to one reload per window, across page loads

/**
 * A reload round trip (reload, edge auth, app boot, first fetch) lands well
 * inside this. A 401 that arrives while a stamp this fresh exists came from the
 * page the last reload produced, so the edge gate passed and the API itself
 * rejected the bearer (API_TOKEN differs between .env and the nginx vhost).
 * Reloading again would loop for as long as the mismatch lasts.
 */
export const RELOAD_WINDOW_MS = 30_000;

const KEY = 'diet-app:401-reload-at';

/**
 * Called on a 401: true means "reload now" and records the attempt. False when
 * a reload already happened within the window, or when sessionStorage is
 * unusable — without a stamp that survives the reload nothing can bound the
 * loop, so the caller surfaces an error instead.
 */
export function claimSessionReload(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY));
    if (last > 0 && now - last >= 0 && now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Any non-401 response proves the session works; forget the last reload. */
export function clearSessionReload(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Unusable storage never held a stamp — claimSessionReload refuses first.
  }
}
