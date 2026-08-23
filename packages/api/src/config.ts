// Parse runtime API config values from environment strings

// Parse a comma-separated CORS_ORIGINS value into a trimmed list.
// Unset, empty, or whitespace-only → []: the live app is same-origin at
// diet.mase.fi so the browser path needs no CORS, and a missing env var must
// never silently widen the allowlist (localhost, the retired apex origin, …).
// Extra origins belong on CORS_ORIGINS.
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
