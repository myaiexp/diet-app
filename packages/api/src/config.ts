// Parse runtime API config values from environment strings

// Production-safe default: the live frontend origin only. Dev adds localhost via
// the CORS_ORIGINS env var so a local Vite server (and nothing else) is allowed.
const PROD_CORS_ORIGINS = ['https://mase.fi'];

// Parse a comma-separated CORS_ORIGINS value into a trimmed, non-empty list.
// Falls back to the production-safe default (mase.fi only) when unset or empty,
// so a missing env var can never silently widen the allowlist to include dev.
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [...PROD_CORS_ORIGINS];
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length ? origins : [...PROD_CORS_ORIGINS];
}
