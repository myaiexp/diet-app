// ApiError + the one place a failure becomes a sentence a user can act on

export interface ApiErrorBody {
  error?: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

const NETWORK =
  'The request never reached the server — check the connection and try again.';

/**
 * A sentence to show the user. Status wins over the body only where the body is
 * terser than the situation warrants (503 says "AI not configured", which means
 * nothing to someone staring at an import form); otherwise the API's own error
 * string is the most specific thing anyone has.
 */
export function userMessage(e: unknown): string {
  if (!isApiError(e)) {
    // fetch rejects (offline, DNS, TLS) with a TypeError carrying no useful text.
    return NETWORK;
  }
  const detail = e.body?.error;
  switch (e.status) {
    case 401:
      // The shell reloads on this; the copy is a fallback for a caught 401.
      return 'Session expired — reloading.';
    case 502:
      return `${detail ?? 'An upstream service failed'} — nothing was saved. Try again.`;
    case 503:
      return 'AI import is not configured on the server.';
    case 500:
      return 'The server hit an unexpected error. Nothing was saved.';
    default:
      return detail ?? `Request failed (${e.status}).`;
  }
}

/** Field-level messages from a Zod `details` payload, when the API sent any. */
export function fieldErrors(e: unknown): string[] {
  if (!isApiError(e)) return [];
  const details = e.body?.details as
    | { formErrors?: string[]; fieldErrors?: Record<string, string[]> }
    | undefined;
  if (!details || typeof details !== 'object') return [];
  const out = [...(details.formErrors ?? [])];
  for (const [field, msgs] of Object.entries(details.fieldErrors ?? {})) {
    for (const msg of msgs) out.push(`${field}: ${msg}`);
  }
  return out;
}
