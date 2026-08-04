// Finnish date/weekday formatting and days-remaining labels

const WEEKDAYS_SHORT = ['su', 'ma', 'ti', 'ke', 'to', 'pe', 'la'];
const WEEKDAYS_LONG = [
  'sunnuntai',
  'maanantai',
  'tiistai',
  'keskiviikko',
  'torstai',
  'perjantai',
  'lauantai',
];

/**
 * Parse a bare YYYY-MM-DD as a UTC calendar date — the shape a Drizzle `date`
 * column returns. Every comparison here stays in UTC on both sides, matching
 * the API's own status arithmetic (pantry-status.ts); mixing in local midnight
 * shifts the day by the host's offset.
 */
function utcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** 'ma' | 'ti' | … | 'su' */
export function finnishWeekday(iso: string): string {
  const d = utcDate(iso);
  return Number.isNaN(d.getTime()) ? '' : (WEEKDAYS_SHORT[d.getUTCDay()] ?? '');
}

/** 'tiistai' — the header bar's long form. */
export function finnishWeekdayLong(iso: string): string {
  const d = utcDate(iso);
  return Number.isNaN(d.getTime()) ? '' : (WEEKDAYS_LONG[d.getUTCDay()] ?? '');
}

/** '4.8.' */
export function finnishDate(iso: string): string {
  const d = utcDate(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

/** Whole UTC days from today to `iso`: negative in the past, 0 today. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const target = utcDate(iso);
  if (Number.isNaN(target.getTime())) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target.getTime() - today) / 86_400_000);
}

/** '1d ago' · 'today' · '1 day' · 'N days' · 'N mo' */
export function daysRemainingLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return '1 day';
  if (days < 60) return `${days} days`;
  return `${Math.round(days / 30)} mo`;
}

/** Monday of the ISO week containing `iso`, as YYYY-MM-DD. */
export function mondayOf(iso: string): string {
  const d = utcDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Sunday closes the week
  d.setUTCDate(d.getUTCDate() - (dow - 1));
  return d.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD by whole days, staying in UTC. */
export function addDays(iso: string, days: number): string {
  const d = utcDate(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week number, for the plan toolbar's `vk 32`. */
export function isoWeekNumber(iso: string): number {
  const d = utcDate(iso);
  if (Number.isNaN(d.getTime())) return 0;
  const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - dow); // Thursday decides the week's year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}
