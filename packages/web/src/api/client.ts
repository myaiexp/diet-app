// fetch wrapper: base URL, JSON bodies, request timeout, one place status → ApiError

import { ApiError, type ApiErrorBody } from './errors.js';

export type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * Default wall-clock bound for a browser request. Above the pool's
 * `query_timeout` (20s) so a live query isn't racing the abort, well under
 * "this screen is frozen." Recipe import overrides — fetch-url 10s + AI 30s
 * would otherwise lose a request that is still going to succeed.
 */
export const REQUEST_TIMEOUT_MS = 25_000;

interface ClientConfig {
  /** Same-origin: nginx serves the app and the API off one vhost. */
  baseUrl: string;
  /** Injectable so tests don't have to monkey-patch a global. */
  fetch: typeof globalThis.fetch | null;
  /**
   * A 401 means the central-hub session expired mid-session — the edge gate
   * would have caught anything else. Reloading re-hits the gate, which
   * redirects to login. It is never a message we show.
   */
  onSessionExpired: () => void;
  /** Default AbortSignal.timeout bound. Tests shorten this. */
  timeoutMs: number;
}

const DEFAULTS: ClientConfig = {
  baseUrl: '/api',
  fetch: null,
  onSessionExpired: () => window.location.reload(),
  timeoutMs: REQUEST_TIMEOUT_MS,
};

let config: ClientConfig = { ...DEFAULTS };

export function configureClient(patch: Partial<ClientConfig>): void {
  config = { ...config, ...patch };
}

/** Restore defaults — used by tests between cases. */
export function resetClient(): void {
  config = { ...DEFAULTS };
}

function buildUrl(path: string, params?: QueryParams): string {
  const url = `${config.baseUrl}${path}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // A proxy error page, not the API. Keep the text as the error string.
    return { error: text.slice(0, 200) };
  }
}

async function send<T>(
  method: string,
  path: string,
  init: { params?: QueryParams; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const doFetch = config.fetch ?? globalThis.fetch;
  const mutating = method !== 'GET' && method !== 'HEAD';
  const options: RequestInit = {
    method,
    // Mutating requests always send JSON Content-Type, even with no body:
    // POST /cook is otherwise CORS-simple and csrfGuard 415s it (finding #7991).
    headers: mutating ? { 'content-type': 'application/json' } : {},
    signal: AbortSignal.timeout(init.timeoutMs ?? config.timeoutMs),
  };
  if (init.body !== undefined) {
    options.body = JSON.stringify(init.body);
  }

  // No Authorization header on purpose: nginx injects it after the auth
  // subrequest passes, so the browser never holds the API token.
  const res = await doFetch(buildUrl(path, init.params), options);

  if (res.status === 401) {
    config.onSessionExpired();
    throw new ApiError(401, null);
  }
  if (res.status === 204) return undefined as T;

  const body = await readBody(res);
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody | null);
  return body as T;
}

export function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
  return send<T>('GET', path, params ? { params } : {});
}

export function apiSend<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  opts?: { timeoutMs?: number },
): Promise<T> {
  return send<T>(method, path, {
    ...(body !== undefined ? { body } : {}),
    ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
}
