// Exact name/alias matching of extracted ingredient names to catalog rows

import { sql } from 'drizzle-orm';
import type { Db } from '@diet-app/db';
import { ingredients } from '@diet-app/db';
import type { MatchKind } from './vocab.js';

export type IngredientCandidate = {
  id: string;
  name: string;
  aliases: string[] | null;
};

export type LineMatch = {
  rawName: string;
  ingredientId: string | null;
  /**
   * The matched catalog row's name, `null` when nothing matched. Carried
   * alongside the id purely so the review screen can name what it bound to —
   * the candidates are already loaded here, so this costs no extra query and
   * saves the client a per-line lookup (#3237).
   */
  ingredientName: string | null;
  match: MatchKind;
};

/** Normalize for comparison: trim, collapse whitespace, case-fold. */
export function normalizeIngredientName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Pure: match one name against an in-memory candidate list. A string reaching
 * exactly one row binds to it. A string reaching several is `ambiguous` and binds
 * to none, a name hit included: "paprika" is the spice's English name and the
 * Finnish word for bell pepper, and only the reader of the recipe can tell which
 * was meant. The review screen forces a pick on any unbound line.
 */
export function matchIngredientName(
  rawName: string,
  candidates: IngredientCandidate[],
): LineMatch {
  const unbound = (match: MatchKind): LineMatch => ({
    rawName,
    ingredientId: null,
    ingredientName: null,
    match,
  });

  const needle = normalizeIngredientName(rawName);
  if (!needle) return unbound('none');

  const isName = (c: IngredientCandidate) => normalizeIngredientName(c.name) === needle;
  const hits = candidates.filter(
    (c) => isName(c) || (c.aliases ?? []).some((a) => normalizeIngredientName(a) === needle),
  );
  if (hits.length === 0) return unbound('none');
  if (hits.length > 1) return unbound('ambiguous');

  const [hit] = hits;
  return {
    rawName,
    ingredientId: hit.id,
    ingredientName: hit.name,
    match: isName(hit) ? 'exact' : 'alias',
  };
}

/** Load catalog candidates and match many names (exact name or alias). */
export async function matchIngredientNames(
  db: Db,
  names: string[],
): Promise<LineMatch[]> {
  if (names.length === 0) return [];

  const needles = [...new Set(names.map(normalizeIngredientName).filter(Boolean))];
  if (needles.length === 0) {
    return names.map((rawName) => ({
      rawName,
      ingredientId: null,
      ingredientName: null,
      match: 'none' as const,
    }));
  }

  // Case-insensitive exact name OR any alias exact match.
  const rows = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      aliases: ingredients.aliases,
    })
    .from(ingredients)
    .where(
      sql`(
        lower(${ingredients.name}) IN (${sql.join(
          needles.map((n) => sql`${n}`),
          sql`, `,
        )})
        OR EXISTS (
          SELECT 1 FROM unnest(coalesce(${ingredients.aliases}, array[]::text[])) AS a(alias)
          WHERE lower(a.alias) IN (${sql.join(
            needles.map((n) => sql`${n}`),
            sql`, `,
          )})
        )
      )`,
    );

  const candidates: IngredientCandidate[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    aliases: r.aliases ?? null,
  }));

  return names.map((rawName) => matchIngredientName(rawName, candidates));
}
