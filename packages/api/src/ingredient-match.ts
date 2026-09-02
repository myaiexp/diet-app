// Exact name/alias matching of extracted ingredient names to catalog rows

import { sql } from 'drizzle-orm';
import type { Db } from '@diet-app/db';
import { ingredients } from '@diet-app/db';

export type MatchKind = 'exact' | 'alias' | 'none';

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

function compareCandidates(a: IngredientCandidate, b: IngredientCandidate): number {
  const byName = a.name.localeCompare(b.name);
  if (byName !== 0) return byName;
  return a.id.localeCompare(b.id);
}

/** Pure: match one name against an in-memory candidate list. */
export function matchIngredientName(
  rawName: string,
  candidates: IngredientCandidate[],
): LineMatch {
  const needle = normalizeIngredientName(rawName);
  if (!needle) {
    return { rawName, ingredientId: null, ingredientName: null, match: 'none' };
  }

  const nameHits = candidates
    .filter((c) => normalizeIngredientName(c.name) === needle)
    .sort(compareCandidates);
  if (nameHits.length > 0) {
    return {
      rawName,
      ingredientId: nameHits[0].id,
      ingredientName: nameHits[0].name,
      match: 'exact',
    };
  }

  const aliasHits = candidates
    .filter((c) =>
      (c.aliases ?? []).some((a) => normalizeIngredientName(a) === needle),
    )
    .sort(compareCandidates);
  if (aliasHits.length > 0) {
    return {
      rawName,
      ingredientId: aliasHits[0].id,
      ingredientName: aliasHits[0].name,
      match: 'alias',
    };
  }

  return { rawName, ingredientId: null, ingredientName: null, match: 'none' };
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
