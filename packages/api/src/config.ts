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

/** OpenAI-compatible client settings. All three required for import to run. */
export type AiConfig = {
  apiKey: string;
  baseUrl: string;
  modelCapable: string;
};

// Ready only when key, base URL, and capable model are all non-empty after trim.
// AI_MODEL_FAST is intentionally ignored for readiness (unused in this slice).
// Never default baseUrl to OpenAI — wrong host with a real key is worse than null.
export function parseAiConfig(env: {
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL_CAPABLE?: string;
  AI_MODEL_FAST?: string;
}): AiConfig | null {
  const apiKey = env.AI_API_KEY?.trim() ?? '';
  const baseUrl = env.AI_BASE_URL?.trim() ?? '';
  const modelCapable = env.AI_MODEL_CAPABLE?.trim() ?? '';
  if (!apiKey || !baseUrl || !modelCapable) return null;
  return { apiKey, baseUrl, modelCapable };
}
