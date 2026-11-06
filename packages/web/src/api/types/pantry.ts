// Pantry item row and its create/patch bodies
import type { StorageLocation as PantryLocation, PantryStatus } from '@diet-app/api/vocab';
import type { Ingredient } from './ingredients.js';

export interface PantryItem {
  id: string;
  ingredientId: string;
  /** numeric column — a string, never a number. */
  quantity: string;
  unit: string;
  location: PantryLocation;
  addedDate: string;
  expiresDate: string;
  opened: boolean | null;
  /**
   * Derived per row by the API (`withStatus`). Render it; never recompute — a
   * second implementation drifts on the UTC-day comparison.
   */
  status: PantryStatus;
  /**
   * Eager-loaded by every pantry endpoint. A row carries only an
   * ingredientId, and every consumer needs the name — fetching them per row
   * would cost one request per row, growing with the pantry.
   */
  ingredient: Ingredient;
  createdAt: string;
  updatedAt: string;
}

export interface PantryCreate {
  ingredientId: string;
  quantity: number;
  unit: string;
  location: PantryLocation;
  addedDate?: string;
  /** Omit and the API derives it from the ingredient's shelf life. */
  expiresDate?: string;
  opened?: boolean;
}

export interface PantryPatch {
  quantity?: number;
  /** The quantity this edit was based on; the API 409s if the row has moved on. */
  expectedQuantity?: number;
  unit?: string;
  location?: PantryLocation;
  addedDate?: string;
  expiresDate?: string;
  opened?: boolean;
}
