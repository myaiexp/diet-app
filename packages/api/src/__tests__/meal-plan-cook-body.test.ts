// POST /meal-plans/:id/cook: the optional { servings } body and actualServings

import { describe, test, expect } from 'vitest';
import { mealPlanEntries } from '@diet-app/db';
import { mealPlanCookRoutes } from '../routes/meal-plan-cook.js';
import {
  makeCookMock,
  ENTRY_ID,
  RECIPE,
  LINE,
  PANTRY_ROW,
  PLANNED_ENTRY,
} from './meal-plan-cook-mock.js';

describe('mealPlanCookRoutes', () => {
  test('records actualServings from the body and leaves planned servings alone', async () => {
    const { db, updatesTo } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '1' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '500', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '4000', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ servings: 4 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Deduction planned at the body's 4, not the entry's stored 1.
    expect(body.deductions[0].requested).toBe(2000);
    expect(body.entry.actualServings).toBe('4');
    expect(body.entry.servings).toBe('1');

    const entryUpdates = updatesTo(mealPlanEntries);
    expect(entryUpdates).toHaveLength(1);
    expect(entryUpdates[0]!.values).toMatchObject({
      status: 'cooked',
      actualServings: '4',
    });
    // The planned figure is the record of intent — cook must never rewrite it.
    expect(entryUpdates[0]!.values).not.toHaveProperty('servings');
  });

  test('records the planned servings as actual when the body is absent', async () => {
    const { db, updatesTo } = makeCookMock({
      entry: { ...PLANNED_ENTRY, servings: '3' },
      recipe: { ...RECIPE, servings: 1 },
      lines: [{ ...LINE, quantity: '100', unit: 'g' }],
      pantryRows: [{ ...PANTRY_ROW, quantity: '4000', unit: 'g' }],
    });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deductions[0].requested).toBe(300);
    expect(body.entry.actualServings).toBe('3');
    expect(updatesTo(mealPlanEntries)[0]!.values).toMatchObject({
      actualServings: '3',
    });
  });

  test('accepts an empty JSON object body', async () => {
    const { db, updatesTo } = makeCookMock({ entry: { ...PLANNED_ENTRY, servings: '2' } });
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(updatesTo(mealPlanEntries)[0]!.values).toMatchObject({
      actualServings: '2',
    });
  });

  test('400s on an out-of-range or malformed cook servings without writing', async () => {
    for (const servings of [0, -2, 13, 0.5, 'abc', null]) {
      const { db, writes } = makeCookMock();
      const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ servings }),
      });
      expect(res.status, `servings=${String(servings)}`).toBe(400);
      expect((await res.json()).error).toBe('Validation failed');
      expect(writes).toEqual([]);
    }
  });

  test('400s on a malformed JSON cook body without writing', async () => {
    const { db, writes } = makeCookMock();
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    expect(writes).toEqual([]);
  });

  test('rejects unknown keys in the cook body', async () => {
    const { db, writes } = makeCookMock();
    const res = await mealPlanCookRoutes(db).request(`/${ENTRY_ID}/cook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cooked' }),
    });
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });
});
