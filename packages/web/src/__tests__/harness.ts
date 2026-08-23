// Shared fetch/DOM test harness for web screen suites.
//
// Every screen suite used to open with private copies of jsonResponse,
// pathOf, flush, mountRoot, makeCtx, and a hand-rolled path-matching fetch
// router. The bodies were identical modulo fixture values — the same
// duplication the API package already solved with db-mock.ts /
// select-router.ts. Suites compose these; they do not re-derive them.
//
// Reads are dispatched by method + pathname (not by invocation order).
// `:param` segments capture path bits, static segments beat params at the
// same depth (`/current` wins over `/:id`), and an unmatched request throws
// naming the method and path — a silent 404 is opt-in via `{ unmatched: '404' }`.

import { vi, type Mock } from 'vitest';
import type { ScreenContext } from '../router.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export interface FetchReq {
  url: URL;
  method: string;
  path: string;
  init?: RequestInit;
  /** Captured `:param` segments from the matched route. */
  params: Record<string, string>;
  json<T = unknown>(): T;
}

export type RouteHandler = (
  req: FetchReq,
) => Response | Promise<Response> | unknown | Promise<unknown>;

/** Keys: `"GET /api/pantry"`, `"/api/ingredients"` (any method), `"GET /api/recipes/:id"`. */
export type RouteTable = Record<string, RouteHandler | Response | object>;

type PathPart = { kind: 'static' | 'param'; value: string };

type RouteValue = RouteHandler | Response | object;

interface CompiledRoute {
  method: string | null;
  parts: PathPart[];
  handler: RouteValue;
}

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function pathOf(input: RequestInfo | URL): string {
  return asUrl(input).pathname;
}

/** Yield to the event loop. With fake timers installed, advances them instead
 * of sleeping on the wall clock — debounce suites can `flush(DEBOUNCE_MS)`
 * without a 200–250ms real wait. */
export async function flush(ms = 0): Promise<void> {
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(ms);
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

export function makeCtx() {
  return {
    setSubtitle: vi.fn<(text: string) => void>(),
    navigate: vi.fn<ScreenContext['navigate']>(),
    isStale: () => false,
  };
}

export function routeFetch(
  routes: RouteTable,
  opts: { unmatched?: 'throw' | '404' } = {},
): Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>> {
  const compiled = Object.entries(routes).map(([key, handler]) => compile(key, handler));
  const unmatched = opts.unmatched ?? 'throw';

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = asUrl(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const winner = pickRoute(compiled, method, url.pathname);
    if (!winner) {
      if (unmatched === '404') return jsonResponse(404, { error: 'unhandled' });
      throw new Error(`unhandled request: ${method} ${url.pathname}`);
    }
    const req: FetchReq = {
      url,
      method,
      path: url.pathname,
      init,
      params: winner.params,
      json: <T = unknown>() => JSON.parse(String(init?.body ?? '{}')) as T,
    };
    return realize(winner.route.handler, req);
  });
}

function asUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input, 'http://localhost');
  if (input instanceof URL) return input;
  return new URL(input.url, 'http://localhost');
}

function compile(key: string, handler: RouteValue): CompiledRoute {
  const space = key.indexOf(' ');
  let method: string | null = null;
  let path = key;
  if (space !== -1) {
    const maybe = key.slice(0, space).toUpperCase();
    if (METHODS.has(maybe)) {
      method = maybe;
      path = key.slice(space + 1);
    }
  }
  const parts: PathPart[] = path
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(':')
        ? { kind: 'param' as const, value: seg.slice(1) }
        : { kind: 'static' as const, value: seg },
    );
  return { method, parts, handler };
}

function matchParts(parts: PathPart[], path: string): Record<string, string> | null {
  const segs = path.split('/').filter(Boolean);
  if (segs.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const seg = segs[i]!;
    if (part.kind === 'static') {
      if (part.value !== seg) return null;
    } else {
      params[part.value] = seg;
    }
  }
  return params;
}

function specificity(route: CompiledRoute): number {
  // Method-bound routes beat any-method; static segments beat params so
  // `/shopping-lists/current` wins over `/shopping-lists/:id`.
  let score = route.method ? 1_000 : 0;
  for (const part of route.parts) score += part.kind === 'static' ? 2 : 1;
  return score;
}

function pickRoute(
  compiled: CompiledRoute[],
  method: string,
  path: string,
): { route: CompiledRoute; params: Record<string, string> } | null {
  let best: { route: CompiledRoute; params: Record<string, string>; score: number } | null = null;
  for (const route of compiled) {
    if (route.method && route.method !== method) continue;
    const params = matchParts(route.parts, path);
    if (!params) continue;
    const score = specificity(route);
    if (!best || score > best.score) best = { route, params, score };
  }
  return best;
}

async function realize(handler: RouteValue, req: FetchReq): Promise<Response> {
  if (typeof handler === 'function') {
    const out = await handler(req);
    return out instanceof Response ? out : jsonResponse(200, out);
  }
  if (handler instanceof Response) return handler.clone();
  return jsonResponse(200, handler);
}
