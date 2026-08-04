// Quantity display formatting (Finnish). DISPLAY ONLY — never send this back.

const THOUSANDS_SEP = ' ';

/**
 * Round to the nearest 5, resolving an exact tie downward-to-even (402.5 → 400,
 * not 405). Half-up would make every .5 quantity drift upward across a list, and
 * a tie has no more claim on one neighbour than the other.
 */
function roundTo5(value: number): number {
  const q = value / 5;
  const floor = Math.floor(q);
  const frac = q - floor;
  let n: number;
  if (frac > 0.5) n = floor + 1;
  else if (frac < 0.5) n = floor;
  else n = floor % 2 === 0 ? floor : floor + 1;
  return n * 5;
}

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEP);
}

/** Number only, no unit — for places that lay the unit out themselves. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  // Above 100 the last few grams are noise; below it they are the recipe.
  const rounded = abs > 100 ? roundTo5(value) : Math.round(value * 10) / 10;
  const fixed = abs > 100 ? rounded.toFixed(0) : rounded.toFixed(1);
  const [intPart = '0', decimals = ''] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '' : '';
  const grouped = groupThousands(intPart);
  if (!decimals || decimals === '0') return `${sign}${grouped}`;
  return `${sign}${grouped},${decimals}`;
}

/**
 * A quantity as the UI shows it: `1,5 kg`, `400 g`, `1 480 g`.
 *
 * Display only. Round-tripping a formatted value into a PATCH would silently
 * corrupt the stored quantity — send the number the API gave you.
 */
export function formatQuantity(value: number, unit: string): string {
  const text = formatNumber(value);
  return unit ? `${text} ${unit}` : text;
}

/** Parse a numeric column (`"400"`) for display maths. NaN-safe. */
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}
