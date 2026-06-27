// Pantry spoilage-status classification (fresh / use_soon / use_today / expired)

export type PantryStatus = 'fresh' | 'use_soon' | 'use_today' | 'expired';

// Classifies a pantry item by how close its expiry is to "today".
//
// `expiresDate` is a bare YYYY-MM-DD string (the shape a Drizzle `date` column
// returns), which V8 parses as UTC midnight. We therefore compare in UTC on
// BOTH sides: `now`'s UTC calendar date vs. the expiry's UTC calendar date.
// Mixing the expiry's UTC-parsed value with local-midnight (setHours) would
// shift the day by the host's UTC offset, misclassifying same-day expiry on a
// server in a non-UTC timezone. Comparing whole UTC days keeps it TZ-stable.
export function computeStatus(expiresDate: string, now: Date = new Date()): PantryStatus {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expires = new Date(expiresDate);
  const expiresUtc = Date.UTC(expires.getUTCFullYear(), expires.getUTCMonth(), expires.getUTCDate());
  const diffDays = (expiresUtc - todayUtc) / (1000 * 60 * 60 * 24);

  if (diffDays < 0) return 'expired';
  if (diffDays <= 1) return 'use_today';
  if (diffDays <= 3) return 'use_soon';
  return 'fresh';
}
