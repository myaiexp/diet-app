// One-line description of a thrown value for journald, cause chain included

const MAX_CHARS = 300;

export function truncateForLog(s: string): string {
  return s.length <= MAX_CHARS ? s : `${s.slice(0, MAX_CHARS)}…`;
}

/**
 * Compact one-line description of a thrown value.
 *
 * Unwrapping `cause` is the whole point for fetch: undici reports every
 * transport failure as `TypeError: fetch failed` and puts the actual reason
 * (ENOTFOUND, ECONNREFUSED, cert errors) in `cause`.
 */
export function describeError(err: unknown): string {
  if (typeof err === 'string') return truncateForLog(err);

  if (err instanceof Error) {
    const parts = [`${err.name}: ${err.message}`];
    const { status, code, cause } = err as {
      status?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (typeof status === 'number') parts.push(`status=${status}`);
    if (typeof code === 'string') parts.push(`code=${code}`);
    if (cause instanceof Error) {
      const causeCode = (cause as { code?: unknown }).code;
      parts.push(
        `cause=${cause.name}: ${cause.message}` +
          (typeof causeCode === 'string' ? ` code=${causeCode}` : ''),
      );
    }
    return truncateForLog(parts.join(' '));
  }

  try {
    return truncateForLog(JSON.stringify(err) ?? String(err));
  } catch {
    return truncateForLog(String(err));
  }
}
