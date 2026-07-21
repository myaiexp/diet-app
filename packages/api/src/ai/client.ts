// OpenAI-compatible client factory from AiConfig (never SDK default host)

import OpenAI from 'openai';
import type { AiConfig } from '../config.js';

/** Wall-clock bound for a single import extraction call (SDK default is 10 min). */
export const AI_REQUEST_TIMEOUT_MS = 30_000;

/** Build a client pinned to config.baseUrl + config.apiKey with tight import bounds. */
export function createAiClient(config: AiConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
    timeout: AI_REQUEST_TIMEOUT_MS,
    maxRetries: 0,
  });
}
