// Shopping list item display order: non-staples first, then category, name, id

// isPantryStaple is read live off the joined ingredient, never snapshotted onto
// the item row: category is stable, but this flag is *designed* to be toggled
// (PATCH /api/ingredients/:id), so a copy would go stale the moment it is.
export interface SortableItem {
  id: string;
  category: string;
  ingredient?: { name?: string | null; isPantryStaple?: boolean | null } | null;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sorts a copy. Staples sink to the bottom rather than being filtered out: the
 * flag has already been observed mis-set once, and a wrong flag should put an
 * ingredient in the wrong *group* (visible, one tap to fix) instead of making
 * it vanish (invisible, discovered while cooking).
 *
 * The id tie-break makes the order total, so two GETs of the same list can
 * never return the items in different orders.
 */
export function sortListItems<T extends SortableItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aStaple = a.ingredient?.isPantryStaple === true;
    const bStaple = b.ingredient?.isPantryStaple === true;
    if (aStaple !== bStaple) return aStaple ? 1 : -1;

    const byCategory = compare(a.category, b.category);
    if (byCategory !== 0) return byCategory;

    const byName = compare(a.ingredient?.name ?? '', b.ingredient?.name ?? '');
    if (byName !== 0) return byName;

    return compare(a.id, b.id);
  });
}
