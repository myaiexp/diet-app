// Parses S-kaupat's Finnish nutrient strings into the nutritionPer100g shape

/** One `{name, value}` pair as the S-kaupat API returns it. */
export interface RawNutrient {
  name: string;
  value: string;
}

/**
 * Per-100g nutrition. Keys are absent — never zero — when undeclared.
 *
 * Energy carries both units. The EU labels kJ as the primary figure and kcal as
 * the secondary one, so keeping only kcal discards the legally primary value.
 */
export interface NutritionPer100g {
  calories?: number;
  energy_kj?: number;
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
  /** Known names whose value did not parse or convert; deliberately not written. */
  unparseable: RawNutrient[];
}

/** A quantity with its unit kept, so callers can check it means what they assume. */
export interface Quantity {
  value: number;
  unit: string;
}

export interface Energy {
  kj: number | null;
  kcal: number | null;
}

/**
 * Grams per unit, for the mass-dimension nutrients. Anything not listed here is
 * refused rather than assumed: the target keys are `_g`-suffixed, so writing an
 * unconverted figure would be a silent magnitude error (sodium is routinely
 * labelled in mg, and 500 mg stored as 500 g is off by a thousand).
 */
const GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  mg: 1e-3,
  µg: 1e-6, // U+00B5 MICRO SIGN
  μg: 1e-6, // U+03BC GREEK SMALL LETTER MU — visually identical, different codepoint
  ug: 1e-6,
};

/**
 * The known vocabulary, keyed by dimension rather than by a bare target key, so
 * unit handling is derived from the declared dimension instead of assumed at each
 * site. Across a full 17,126-product store dump these eight names were the only
 * ones that appeared; a ninth is reported, not silently dropped.
 */
type Spec =
  | { dimension: 'mass'; key: keyof NutritionPer100g }
  | { dimension: 'energy' };

const SPECS: Record<string, Spec> = {
  Energia: { dimension: 'energy' },
  Proteiinia: { dimension: 'mass', key: 'protein_g' },
  Rasvaa: { dimension: 'mass', key: 'fat_g' },
  'josta tyydyttyneitä rasvoja': { dimension: 'mass', key: 'saturated_fat_g' },
  Hiilihydraattia: { dimension: 'mass', key: 'carbs_g' },
  'josta sokereita': { dimension: 'mass', key: 'sugars_g' },
  Ravintokuitua: { dimension: 'mass', key: 'fiber_g' },
  Suola: { dimension: 'mass', key: 'salt_g' },
};

/** Sub-nutrients arrive prefixed with "- "; strip it before lookup. */
function normaliseName(name: string): string {
  return name.replace(/^[-–\s]+/, '').trim();
}

function toNumber(raw: string): number | null {
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads "<number> <unit>" and keeps BOTH halves.
 *
 * Anchored, so an approximate form ("<0,5 g", "n. 3 g") fails outright rather than
 * being rounded into a fabricated nutrition claim. A missing unit yields `unit: ''`,
 * which the mass path then refuses — absent is not the same as grams.
 */
export function parseQuantity(value: string): Quantity | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^([\d.,]+)\s*([a-zA-Zµμ]*)$/);
  if (!m?.[1]) return null;
  const n = toNumber(m[1]);
  return n === null ? null : { value: n, unit: m[2] ?? '' };
}

/**
 * Reads an energy string, keeping both units. S-kaupat sends "196 kJ / 47 kcal",
 * but each side is read independently so a single-unit string still works.
 */
export function parseEnergy(value: string): Energy | null {
  if (typeof value !== 'string') return null;
  const kj = value.match(/([\d.,]+)\s*kJ/i);
  const kcal = value.match(/([\d.,]+)\s*kcal/i);
  if (!kj && !kcal) return null;
  return {
    kj: kj?.[1] ? toNumber(kj[1]) : null,
    kcal: kcal?.[1] ? toNumber(kcal[1]) : null,
  };
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
    const spec = SPECS[normaliseName(item.name)];
    if (!spec) {
      unknownNames.push(item.name);
      continue;
    }

    if (spec.dimension === 'energy') {
      const energy = parseEnergy(item.value);
      if (!energy) {
        unparseable.push(item);
        continue;
      }
      if (energy.kcal !== null) nutrition.calories = energy.kcal;
      if (energy.kj !== null) nutrition.energy_kj = energy.kj;
      continue;
    }

    const quantity = parseQuantity(item.value);
    const factor = quantity ? GRAMS_PER_UNIT[quantity.unit] : undefined;
    if (!quantity || factor === undefined) {
      unparseable.push(item);
      continue;
    }
    // Round-trip through a fixed precision: 500 * 1e-3 is 0.5, but 2500 * 1e-6 is
    // 0.0024999999999999996 in binary floating point.
    nutrition[spec.key] = Number((quantity.value * factor).toPrecision(12));
  }

  return {
    nutrition: Object.keys(nutrition).length > 0 ? nutrition : null,
    unknownNames,
    unparseable,
  };
}
