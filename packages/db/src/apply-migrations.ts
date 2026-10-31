// Apply drizzle migrations in-process, so a failure arrives with its Postgres error
//
// `drizzle-kit migrate` exits 1 after "applying migrations..." with no message when a
// statement fails, and a wrapper cannot print what the binary swallowed. drizzle-orm's
// migrate() is the same migrator on the same bookkeeping table, and it throws.

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type Db } from './connection.js';

/** The API's pool timeouts would cancel a slow migration; DDL here runs to completion. */
export function openMigrationDb(url: string): Db {
  return createDb(url, {
    statement_timeout: 0,
    query_timeout: 0,
    idle_in_transaction_session_timeout: 0,
  });
}

export async function applyMigrations(db: Db, migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}

/** Every message down the cause chain: drizzle's names the query, pg's the reason. */
export function describeMigrationError(err: unknown): string {
  const lines: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    const code = (current as { code?: string }).code;
    lines.push(code ? `${current.message} (${code})` : current.message);
    current = current.cause;
  }
  if (lines.length === 0) return String(err);
  return lines.join('\n  caused by: ');
}
