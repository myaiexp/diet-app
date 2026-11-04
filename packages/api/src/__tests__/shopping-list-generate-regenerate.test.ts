// Generate regeneration: upserts and deletes that protect bought/manual rows

import { describe, test, expect } from 'vitest';
import { and, eq, not, or } from 'drizzle-orm';
import { shoppingListItems } from '@diet-app/db';
import { renderWhere } from './drizzle-introspect.js';
import {
  renderSql,
  LIST_ID,
  ING_ID,
  MONDAY,
  DRAFT_LIST,
  makeGenerateMock,
  post,
  planFixtures,
} from './shopping-list-generate-test-helpers.js';

describe('shoppingListGenerateRoutes', () => {
  test('rewrites quantities on regeneration without touching bought', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    const res = await post(mock.db, { weekStarting: MONDAY });
    expect(res.status).toBe(200);

    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(itemInsert.conflict?.target).toEqual([
      shoppingListItems.listId,
      shoppingListItems.ingredientId,
      shoppingListItems.unit,
    ]);
    const setKeys = Object.keys(itemInsert.conflict?.set as object);
    expect(setKeys.sort()).toEqual(['category', 'netToBuy', 'quantityInPantry', 'quantityNeeded'].sort());
    expect(setKeys).not.toContain('bought');
    // Without this, a colliding manual row (same list/ingredient/unit) is
    // rewritten by the plan's numbers — the documented "never revisit manual
    // rows" contract. The prune is already source-scoped; the upsert must be too.
    expect(itemInsert.conflict?.setWhere).toEqual(eq(shoppingListItems.source, 'generated'));
    // A quantity the user edited is not generation's to overwrite. The flag
    // stays out of the SET (a regenerate must not clear it) and each quantity
    // column keeps the stored value when it is set.
    const set = itemInsert.conflict?.set as Record<string, unknown>;
    expect(setKeys).not.toContain('quantityEdited');
    for (const column of ['quantityNeeded', 'quantityInPantry', 'netToBuy']) {
      const sql = renderSql(set[column]);
      expect(sql, column).toContain('quantity_edited');
      expect(sql, column).toContain(`excluded.${column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`);
    }
    expect(renderSql(set.category)).not.toContain('quantity_edited');
  });

  test('preserves customNote on regeneration', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const itemInsert = mock.insertsTo(shoppingListItems)[0]!;
    expect(Object.keys(itemInsert.conflict?.set as object)).not.toContain('customNote');
    expect(Object.keys(itemInsert.conflict?.set as object)).not.toContain('source');
  });

  test('preserves manual rows absent from the plan (delete predicate is source-scoped)', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    const { sql, params } = renderWhere(del.where);
    expect(sql).toContain('source');
    expect(params).toContain('generated');
    // A manual row can never match this predicate regardless of the plan, since
    // the predicate only ever selects source = 'generated' rows.
    expect(params).not.toContain('manual');
  });

  test('keeps a generated row that was already bought even when the plan drops it', async () => {
    // Empty plan this time: the fresh item list is empty, so the only thing
    // standing between "drop everything" and "keep bought rows" is the
    // bought = false term in the delete predicate.
    const mock = makeGenerateMock({ existingList: DRAFT_LIST, findManyItems: [] });
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    expect(del.where).toEqual(
      and(
        eq(shoppingListItems.listId, LIST_ID),
        eq(shoppingListItems.source, 'generated'),
        eq(shoppingListItems.bought, false),
      ),
    );
  });

  test('deletes generated unbought rows the plan no longer calls for', async () => {
    const mock = makeGenerateMock(planFixtures(DRAFT_LIST));
    await post(mock.db, { weekStarting: MONDAY });
    const del = mock.deletesTo(shoppingListItems)[0]!;
    // Structurally: only rows matching this week's (ingredient, unit) survive;
    // everything else generated-and-unbought is deleted by the NOT(OR(...)).
    expect(del.where).toEqual(
      and(
        eq(shoppingListItems.listId, LIST_ID),
        eq(shoppingListItems.source, 'generated'),
        eq(shoppingListItems.bought, false),
        not(or(and(eq(shoppingListItems.ingredientId, ING_ID), eq(shoppingListItems.unit, 'g')))!),
      ),
    );
  });

});
