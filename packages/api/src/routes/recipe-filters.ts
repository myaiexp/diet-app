// SQL filter builders for the recipes list endpoint.
import { sql, type SQL } from 'drizzle-orm';
import { recipes } from '@diet-app/db';

// Build a tag-containment condition from a raw ?tags= query value.
//
// Splits on comma so `?tags=pasta,italian` matches recipes whose `tags` array
// contains BOTH 'pasta' AND 'italian' (Postgres `@>` is "contains all" — this
// narrows results, the conventional meaning of a multi-value filter). For OR
// semantics the operator would be `&&` (array overlap); we intentionally use
// `@>` here.
//
// SAFETY (audit #recipes-tags-injection): every tag is interpolated via the
// Drizzle `sql` template, which binds each value as a separate placeholder
// ($1, $2, …) — it is NOT raw string concatenation. The rendered SQL is
// `"recipes"."tags" @> ARRAY[$1, $2]::text[]` with the tag strings as bound
// params, so the query is injection-safe by construction. Do NOT refactor this
// to `sql.raw()` or string concatenation, which would reintroduce that risk.
//
// Returns undefined when the value yields no usable tags (empty string, or only
// commas/whitespace) so the caller adds no WHERE clause at all.
export function buildTagsCondition(raw: string): SQL | undefined {
  const tags = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) return undefined;
  const elements = sql.join(
    tags.map((t) => sql`${t}`),
    sql`, `
  );
  return sql`${recipes.tags} @> ARRAY[${elements}]::text[]`;
}
