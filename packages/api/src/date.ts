// ISO week-bounds helper: Monday→Sunday (UTC) for a given YYYY-MM-DD date.

// Returns the Monday and Sunday (inclusive, UTC) bounding the ISO week that
// contains `dateStr`. A Sunday input maps back to the Monday six days earlier,
// so the week never spans forward past the input. Callers must pass a valid
// YYYY-MM-DD date (see isIsoDate in validation.ts) — an invalid string yields an
// Invalid Date and throws RangeError on .toISOString().
export function getISOWeekBounds(dateStr: string): { monday: string; sunday: string } {
  const date = new Date(dateStr);
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    monday: monday.toISOString().slice(0, 10),
    sunday: sunday.toISOString().slice(0, 10),
  };
}
