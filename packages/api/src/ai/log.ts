// Server-side failure logging for the recipe-import chain (journalctl is the only channel)

import { describeError, truncateForLog } from '../describe-error.js';

/**
 * Strip userinfo from a URL-shaped context value before it reaches journald.
 *
 * Rejected redirect targets and raw `Location` headers are attacker-controlled:
 * a 302 to `https://user:pass@host/` would otherwise print the password to the
 * log. Redacting in the sink rather than at each call site keeps a future
 * context field from reintroducing the leak. The `***` placeholders stay so an
 * operator can still see that credentials were present — that is itself the
 * diagnostic fact. Values that are not absolute URLs pass through untouched.
 */
function redactUserinfo(s: string): string {
  if (!s.includes('@')) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return s;
  }
  if (url.username === '' && url.password === '') return s;
  if (url.username !== '') url.username = '***';
  if (url.password !== '') url.password = '***';
  return url.href;
}

/**
 * Log an import-chain failure before collapsing it to a sentinel.
 *
 * The HTTP responses stay opaque on purpose (no cause detail to the client);
 * this is the operator's only signal for telling a bad AI_API_KEY apart from a
 * flaky recipe site when the route answers a flat 502.
 */
export function logImportFailure(
  stage: string,
  detail?: unknown,
  context?: Record<string, string | number>,
): void {
  const ctx = context
    ? Object.entries(context)
        .map(([k, v]) => ` ${k}=${truncateForLog(redactUserinfo(String(v)))}`)
        .join('')
    : '';
  const cause = detail === undefined ? '' : `: ${describeError(detail)}`;
  console.error(`[recipe-import] ${stage}${ctx}${cause}`);
}
