// Unit → dimension/base conversion (mass/volume/count)

export type Dimension = 'mass' | 'volume' | 'count';

interface UnitInfo {
  dimension: Dimension;
  factor: number;
}

// factor converts one of that unit into the dimension's base:
// mass → g, volume → ml, count → pieces.
const UNITS: Record<string, UnitInfo> = {
  mg: { dimension: 'mass', factor: 0.001 },
  g: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  ml: { dimension: 'volume', factor: 1 },
  cl: { dimension: 'volume', factor: 10 },
  dl: { dimension: 'volume', factor: 100 },
  l: { dimension: 'volume', factor: 1000 },
  tsp: { dimension: 'volume', factor: 5 },
  tl: { dimension: 'volume', factor: 5 },
  tbsp: { dimension: 'volume', factor: 15 },
  rkl: { dimension: 'volume', factor: 15 },
  piece: { dimension: 'count', factor: 1 },
  pieces: { dimension: 'count', factor: 1 },
  pcs: { dimension: 'count', factor: 1 },
  kpl: { dimension: 'count', factor: 1 },
};

// Resolve free-text unit to dimension + base factor. Unknown → null.
export function resolveUnit(unit: string): { dimension: Dimension; factor: number } | null {
  const key = unit.trim().toLowerCase();
  if (!key) return null;
  return UNITS[key] ?? null;
}

// quantity in `unit` → base value. null when the unit is unknown.
export function toBase(
  quantity: number,
  unit: string,
): { dimension: Dimension; value: number } | null {
  const info = resolveUnit(unit);
  if (!info) return null;
  return { dimension: info.dimension, value: quantity * info.factor };
}

// base value → quantity expressed in `unit`. null when the unit is unknown.
export function fromBase(value: number, unit: string): number | null {
  const info = resolveUnit(unit);
  if (!info) return null;
  return value / info.factor;
}

// The base unit label for a dimension: mass → g, volume → ml, count → pieces.
export function baseUnit(dimension: Dimension): 'g' | 'ml' | 'pieces' {
  switch (dimension) {
    case 'mass':
      return 'g';
    case 'volume':
      return 'ml';
    case 'count':
      return 'pieces';
  }
}

// Shared by cook-deduct and shopping-aggregate so their rounding cannot drift.
export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
