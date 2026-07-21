// OpenAI-compatible client factory from AiConfig (never SDK default host)

import OpenAI from 'openai';
import type { AiConfig } from '../config.js';

/** Build a client pinned to config.baseUrl + config.apiKey. */
export function createAiClient(config: AiConfig): OpenAI {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
}
