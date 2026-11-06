// Recipe import draft: the AI-extracted recipe and its ingredient lines
import type { MatchKind } from '@diet-app/api/vocab';

export interface DraftIngredientLine {
  rawName: string;
  ingredientId: string | null;
  /** Name of the catalog row `ingredientId` points at — `null` when unmatched. */
  ingredientName: string | null;
  quantity: number;
  unit: string;
  optional: boolean;
  notes: string | null;
  match: MatchKind;
  /** The model invented this quantity — the review screen's `assumed` state. */
  quantityInferred: boolean;
}

export interface RecipeDraft {
  title: string;
  sourceType: 'imported';
  sourceUrl: string | null;
  steps: string[];
  servings: number;
  prepTime: number | null;
  totalTime: number | null;
  effortScore: number | null;
  tags: string[];
  cuisineType: string | null;
  ingredients: DraftIngredientLine[];
}

export interface RecipeImportResponse {
  draft: RecipeDraft;
  unmatchedCount: number;
  /**
   * URL fetch hit IMPORT_TEXT_MAX_CHARS and the model saw a partial page.
   * Always false on the paste path (oversize paste is 400, never truncated).
   */
  truncated: boolean;
  /**
   * The fetched page stripped to under IMPORT_TEXT_MIN_CHARS — a 200 that
   * carried no recipe, i.e. the page renders with JavaScript. Also always false
   * on the paste path.
   */
  lowYield: boolean;
}
