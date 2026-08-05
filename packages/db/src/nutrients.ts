// Parses S-kaupat's Finnish nutrient strings into the nutritionPer100g shape

/** One `{name, value}` pair as the S-kaupat API returns it. */
export interface RawNutrient {
  name: string;
  value: string;
}

/** Per-100g nutrition. Keys are absent — never zero — when undeclared. */
export interface NutritionPer100g {
  calories?: number;
  protein_g?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  carbs_g?: number;
  sugars_g?: number;
  fiber_g?: number;
  salt_g?: number;
}

export interface ParsedNutrients {
  /** null when the product declared nothing we could use at all. */
  nutrition: NutritionPer100g | null;
  /** Names outside the known vocabulary — surfaced so the importer can report drift. */
  unknownNames: string[];
  /** Known names whose value did not parse; deliberately not written as 0. */
  unparseable: RawNutrient[];
}

/**
 * The complete vocabulary: across a full 17,126-product store dump these eight
 * names were the only ones that appeared. A ninth showing up is a signal the
 * upstream shape changed, so it is reported rather than ignored.
 */
const NAME_TO_KEY: Record<string, keyof NutritionPer100g> = {
  Energia: 'calories',
  Proteiinia: 'protein_g',
  Rasvaa: 'fat_g',
  'josta tyydyttyneitä rasvoja': 'saturated_fat_g',
  Hiilihydraattia: 'carbs_g',
  'josta sokereita': 'sugars_g',
  Ravintokuitua: 'fiber_g',
  Suola: 'salt_g',
};

/** Sub-nutrients arrive prefixed with "- "; strip it before lookup. */
function normaliseName(name: string): string {
  return name.replace(/^[-–\s]+/, '').trim();
}

/**
 * Reads one value string to a number, or null when it cannot be read exactly.
 *
 * Energy arrives dual-unit ("196 kJ / 47 kcal") and we want the kcal side, so a
 * kcal match wins over the leading number. Everything else is "<number> <unit>"
 * with a Finnish decimal comma. Approximate forms ("<0,5 g") are refused rather
 * than rounded: a fabricated number here silently becomes a nutrition claim.
 */
export function parseNutrientValue(value: string): number | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  const kcal = text.match(/([\d.,]+)\s*kcal/i);
  if (kcal?.[1]) return toNumber(kcal[1]);

  // Anchored so a leading "<", "~" or "n." makes the whole value unparseable.
  const plain = text.match(/^([\d.,]+)\s*[a-zµ]*$/i);
  if (plain?.[1]) return toNumber(plain[1]);

  return null;
}

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Folds a product's raw nutrient list into nutritionPer100g plus what was rejected. */
export function parseNutrients(
  raw: RawNutrient[] | null | undefined,
): ParsedNutrients {
  const nutrition: NutritionPer100g = {};
  const unknownNames: string[] = [];
  const unparseable: RawNutrient[] = [];

  for (const item of raw ?? []) {
    if (!item?.name) continue;
    const key = NAME_TO_KEY[normaliseName(item.name)];
    if (!key) {
      unknownNames.push(item.name);
      continue;
    }
    const parsed = parseNutrientValue(item.value);
    if (parsed === null) {
      unparseable.push(item);
      continue;
    }
    nutrition[key] = parsed;
  }

  return {
    nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
    unknownNames,
    unparseable,
  };
}
