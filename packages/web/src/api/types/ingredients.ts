// Ingredient catalog row as the API returns it

export interface Ingredient {
  id: string;
  name: string;
  aliases: string[] | null;
  category: string;
  defaultUnit: string;
  nutritionPer100g: Record<string, number> | null;
  shelfLife: Record<string, number | null> | null;
  tags: string[] | null;
  isStaple: boolean | null;
  createdAt: string;
  updatedAt: string;
}
