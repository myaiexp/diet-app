// Resolve pantry expiresDate from ingredient shelf-life defaults on create

export type ShelfLife = Record<string, number | null | undefined>;

/** Returns YYYY-MM-DD or null if no shelf-life default for location. */
export function resolveExpiresDate(
  shelfLife: ShelfLife | null | undefined,
  location: string,
  addedDate: string, // YYYY-MM-DD
): string | null {
  if (!shelfLife || typeof shelfLife !== 'object') return null;
  const key = `${location}_days`;
  const days = shelfLife[key];
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return null;

  // Calendar-date arithmetic in UTC — same spirit as computeStatus.
  const base = new Date(`${addedDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
