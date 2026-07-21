// Pure recipe view scaling for GET /recipes/:id?servings=N (no DB write)

export type RecipeIngredientLineView = {
  id: string;
  recipeId?: string;
  ingredientId: string;
  quantity: string | number;
  unit: string;
  optional?: boolean | null;
  notes?: string | null;
  ingredient?: unknown;
  [key: string]: unknown;
};

export type RecipeWithIngredients = {
  id: string;
  servings: number | string | null;
  recipeIngredients?: RecipeIngredientLineView[];
  [key: string]: unknown;
};

export type ScaledRecipe = RecipeWithIngredients & {
  servings: number;
  baseServings: number;
  recipeIngredients: RecipeIngredientLineView[];
};

export type ScaleResult =
  | { ok: true; recipe: ScaledRecipe }
  | { ok: false; error: 'invalid_target' | 'invalid_base' };

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function asPositiveFinite(n: unknown): number | null {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

/** Scale a loaded recipe view to targetServings. Deep-copies; never mutates input. */
export function scaleRecipeView(
  recipe: RecipeWithIngredients,
  targetServings: number,
): ScaleResult {
  if (!Number.isFinite(targetServings) || targetServings <= 0) {
    return { ok: false, error: 'invalid_target' };
  }
  const base = asPositiveFinite(recipe.servings);
  if (base === null) {
    return { ok: false, error: 'invalid_base' };
  }

  const factor = targetServings / base;
  const lines = (recipe.recipeIngredients ?? []).map((line) => {
    const qty = Number(line.quantity);
    const scaledQty = Number.isFinite(qty) ? String(round6(qty * factor)) : String(line.quantity);
    return {
      ...line,
      quantity: scaledQty,
      ...(line.ingredient !== undefined ? { ingredient: structuredClone(line.ingredient) } : {}),
    };
  });

  const { recipeIngredients: _drop, ...header } = recipe;
  return {
    ok: true,
    recipe: {
      ...structuredClone(header),
      servings: targetServings,
      baseServings: base,
      recipeIngredients: lines,
    } as ScaledRecipe,
  };
}
