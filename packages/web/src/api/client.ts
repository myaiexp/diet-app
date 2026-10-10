// fetch wrapper: base URL, JSON bodies, request timeout, one place status → ApiError

import {
  ApiError,
  SessionRejectedError,
  UnexpectedBodyError,
  type ApiErrorBody,
} from './errors.js';
import { claimSessionReload, clearSessionReload } from './reload-guard.js';

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
   * A 401 usually means the central-hub session expired mid-session; reloading
   * re-hits the edge gate, which redirects to login. `send` calls this at most
   * once per reload window (reload-guard.ts): a 401 on the page that reload
   * produced means the API itself rejects the bearer, and that gets shown.
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

/** Parsed JSON, or the raw text when the body is not JSON (a proxy or SPA page). */
type Body = { json: unknown } | { text: string };

async function readBody(res: Response): Promise<Body> {
  const text = await res.text();
  if (!text) return { json: null };
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return { text: text.slice(0, 200) };
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
    if (!claimSessionReload()) throw new SessionRejectedError();
    config.onSessionExpired();
    throw new ApiError(401, null);
  }
  clearSessionReload();
  if (res.status === 204) return undefined as T;

  const body = await readBody(res);
  if (!res.ok) {
    // A proxy error page keeps its text as the error string.
    const errBody = 'json' in body ? (body.json as ApiErrorBody | null) : { error: body.text };
    throw new ApiError(res.status, errBody);
  }
  // A success status with a non-JSON body is never API data; resolving it
  // would hand screens an `{ error }` object shaped like the resource.
  if ('text' in body) throw new UnexpectedBodyError(res.status, body.text);
  return body.json as T;
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
