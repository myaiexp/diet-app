// createAiClient pins timeout/retries/baseURL off the OpenAI SDK defaults.

import { describe, test, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { createAiClient, AI_REQUEST_TIMEOUT_MS } from '../ai/client.js';
import { recipeImportRoutes } from '../routes/recipe-import.js';
import type { AiConfig } from '../config.js';

const AI: AiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://ai.example.com/v1',
  modelCapable: 'capable-model',
};

describe('createAiClient', () => {
  test('pins timeout, retries, apiKey, and baseURL off SDK defaults', () => {
    const client = createAiClient(AI);
    expect(client).toBeInstanceOf(OpenAI);
    expect(client.apiKey).toBe(AI.apiKey);
    expect(client.baseURL).toBe(AI.baseUrl);
    expect(client.timeout).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(client.timeout).toBe(30_000);
    expect(client.maxRetries).toBe(0);
    // A one-line revert to `new OpenAI({ apiKey })` would restore these.
    expect(client.timeout).not.toBe(OpenAI.DEFAULT_TIMEOUT);
    expect(client.maxRetries).not.toBe(2);
    expect(client.baseURL).not.toContain('api.openai.com');
  });
});

describe('recipe import default createAiClient path', () => {
  test('non-injected import constructs via createAiClient(opts.ai)', async () => {
    const extractRecipeFromText = vi.fn(
      async (_client: OpenAI, _model: string, _text: string) => ({
        ok: true as const,
        recipe: {
          title: 'Plain',
          steps: [],
          ingredients: [{ name: 'Egg', quantity: 1, unit: 'g' }],
        },
      }),
    );
    const matchIngredientNames = vi.fn(async () => [
      { rawName: 'Egg', ingredientId: null, match: 'none' as const },
    ]);
    const db = {
      insert: vi.fn(),
      select: vi.fn(),
      query: {},
      transaction: vi.fn(),
    };

    const app = recipeImportRoutes(db as never, {
      ai: AI,
      extractRecipeFromText: extractRecipeFromText as never,
      fetchUrlAsText: vi.fn(async () => {
        throw new Error('url path must not run');
      }) as never,
      matchIngredientNames: matchIngredientNames as never,
      // createAiClient omitted — production default, not the injected mock.
    });

    const res = await app.request('/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'eggs' }),
    });
    expect(res.status).toBe(200);
    expect(extractRecipeFromText).toHaveBeenCalledOnce();

    const [client, model] = extractRecipeFromText.mock.calls[0]!;
    expect(client).toBeInstanceOf(OpenAI);
    expect(client.apiKey).toBe(AI.apiKey);
    expect(client.baseURL).toBe(AI.baseUrl);
    expect(client.timeout).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(client.maxRetries).toBe(0);
    expect(model).toBe(AI.modelCapable);
  });
});
