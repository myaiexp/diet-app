// Unit tests for AI recipe extract parse + extractRecipeFromText (mocked client)

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseExtractedRecipe,
  stripJsonFences,
  extractRecipeFromText,
} from '../ai/import-recipe.js';

// Failure paths log to console.error by design; capture instead of printing so
// the suite stays readable, and assert on the lines in 'failure logging'.
let logged: string[] = [];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_JSON = JSON.stringify({
  title: 'Pancakes',
  steps: ['Mix', 'Fry'],
  servings: 4,
  prepTime: 10,
  totalTime: 25,
  cuisineType: 'american',
  tags: ['breakfast'],
  effortScore: 2,
  ingredients: [
    { name: 'Flour', quantity: 200, unit: 'g' },
    { name: 'Egg', quantity: 2, unit: 'kpl', optional: false, notes: null },
  ],
});

describe('stripJsonFences', () => {
  test('strips markdown json fences', () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test('leaves bare JSON alone', () => {
    expect(stripJsonFences('{"a":1}')).toBe('{"a":1}');
  });
});

describe('parseExtractedRecipe', () => {
  test('parses valid extraction JSON', () => {
    const result = parseExtractedRecipe(VALID_JSON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.title).toBe('Pancakes');
    expect(result.recipe.ingredients).toHaveLength(2);
    expect(result.recipe.steps).toEqual(['Mix', 'Fry']);
    expect(result.recipe.servings).toBe(4);
  });

  test('parses fenced JSON', () => {
    const result = parseExtractedRecipe(`\`\`\`json\n${VALID_JSON}\n\`\`\``);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.title).toBe('Pancakes');
  });

  test('defaults steps to empty array when omitted', () => {
    const raw = JSON.stringify({
      title: 'Soup',
      ingredients: [{ name: 'Water', quantity: 1, unit: 'l' }],
    });
    const result = parseExtractedRecipe(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.steps).toEqual([]);
  });

  test('fails when title missing', () => {
    const raw = JSON.stringify({
      ingredients: [{ name: 'Salt', quantity: 1, unit: 'g' }],
    });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });

  test('fails when title empty', () => {
    const raw = JSON.stringify({
      title: '   ',
      ingredients: [{ name: 'Salt', quantity: 1, unit: 'g' }],
    });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });

  test('fails when zero ingredients', () => {
    const raw = JSON.stringify({ title: 'Empty', ingredients: [] });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });

  test('fails on invalid JSON', () => {
    expect(parseExtractedRecipe('not-json')).toEqual({ ok: false });
  });

  test('fails when ingredient quantity not positive', () => {
    const raw = JSON.stringify({
      title: 'Bad qty',
      ingredients: [{ name: 'Salt', quantity: 0, unit: 'g' }],
    });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });

  test('keeps the model\'s quantityInferred flag', () => {
    const raw = JSON.stringify({
      title: 'Sipulikeitto',
      ingredients: [
        { name: 'Onion', quantity: 150, unit: 'g', quantityInferred: true },
        { name: 'Butter', quantity: 40, unit: 'g' },
      ],
    });
    const result = parseExtractedRecipe(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.ingredients[0]!.quantityInferred).toBe(true);
    // Absent stays absent here — the route defaults it, so a model that never
    // emits the field can't be told apart from one that emitted false.
    expect(result.recipe.ingredients[1]!.quantityInferred).toBeUndefined();
  });

  test('the flag marks provenance, it does not make quantity optional', () => {
    const raw = JSON.stringify({
      title: 'No amount',
      ingredients: [{ name: 'Dill', unit: 'g', quantityInferred: true }],
    });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });

  test('rejects a non-boolean quantityInferred', () => {
    const raw = JSON.stringify({
      title: 'Bad flag',
      ingredients: [
        { name: 'Salt', quantity: 5, unit: 'g', quantityInferred: 'yes' },
      ],
    });
    expect(parseExtractedRecipe(raw)).toEqual({ ok: false });
  });
});

describe('extractRecipeFromText', () => {
  test('returns parsed recipe from chat completion content', async () => {
    const create = vi.fn(async () => ({
      choices: [{ message: { content: VALID_JSON } }],
    }));
    const client = { chat: { completions: { create } } } as any;

    const result = await extractRecipeFromText(client, 'model-capable', 'paste text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recipe.title).toBe('Pancakes');
    expect(create).toHaveBeenCalledOnce();
    const args = (create.mock.calls as unknown as [{ model: string; response_format: unknown; messages: { content: string }[] }[]])[0]![0];
    expect(args.model).toBe('model-capable');
    expect(args.response_format).toEqual({ type: 'json_object' });
    expect(args.messages[1]!.content).toBe('paste text');
  });

  test('returns ok false on empty content', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '' } }] }),
        },
      },
    } as any;
    expect(await extractRecipeFromText(client, 'm', 'x')).toEqual({ ok: false });
  });

  test('returns ok false when API throws', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => {
            throw new Error('network');
          },
        },
      },
    } as any;
    expect(await extractRecipeFromText(client, 'm', 'x')).toEqual({ ok: false });
  });

  test('returns ok false when content fails validation', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: '{"title":"x","ingredients":[]}' } }],
          }),
        },
      },
    } as any;
    expect(await extractRecipeFromText(client, 'm', 'x')).toEqual({ ok: false });
  });
});

describe('extract failure logging', () => {
  test('logs the API cause — a bad key must not look like a bad model', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => {
            throw Object.assign(new Error('Incorrect API key provided'), {
              status: 401,
            });
          },
        },
      },
    } as any;

    expect(await extractRecipeFromText(client, 'model-capable', 'x')).toEqual({
      ok: false,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain('[recipe-import] chat completion failed');
    expect(logged[0]).toContain('model=model-capable');
    expect(logged[0]).toContain('Incorrect API key provided');
    expect(logged[0]).toContain('status=401');
  });

  test('logs empty content distinctly from an API error', async () => {
    const client = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '' } }] }),
        },
      },
    } as any;

    await extractRecipeFromText(client, 'model-capable', 'x');
    expect(logged[0]).toContain('[recipe-import] model returned empty content');
    expect(logged[0]).toContain('model=model-capable');
  });

  test('logs unparseable model output', () => {
    parseExtractedRecipe('not-json');
    expect(logged[0]).toContain('[recipe-import] model output is not JSON');
  });

  test('logs which fields failed schema validation', () => {
    parseExtractedRecipe(JSON.stringify({ title: 'Empty', ingredients: [] }));
    expect(logged[0]).toContain('[recipe-import] model JSON failed schema validation');
    expect(logged[0]).toContain('ingredients');
  });
});
