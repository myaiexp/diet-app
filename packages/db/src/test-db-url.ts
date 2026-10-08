// Parse a Postgres URL's database name, and refuse a test run that is not *_test

/**
 * Database name from a postgres URL path. Mirrors scripts/setup-test-db.sh:
 * strip the scheme, drop the authority, drop the query string, keep the first
 * path segment. The user, password, host and query are not part of the name —
 * `_test` appearing in any of them must not satisfy the guard below.
 */
export function resolveDbName(connectionString: string): string {
  const schemeIdx = connectionString.indexOf('://');
  const afterScheme = schemeIdx === -1 ? connectionString : connectionString.slice(schemeIdx + 3);
  const slashIdx = afterScheme.indexOf('/');
  const path = slashIdx === -1 ? '' : afterScheme.slice(slashIdx + 1);
  return path.split('?')[0].split('/')[0];
}

/**
 * Hard-stop a suite whose TEST_DATABASE_URL is not a `*_test` database.
 * The thrown error names the database only: the URL itself can carry a password.
 */
export function assertTestDbUrl(url: string): void {
  const name = resolveDbName(url);
  if (name.endsWith('_test')) return;
  throw new Error(
    `Refusing to run tests: TEST_DATABASE_URL database is "${name || '(none)'}", ` +
      'which does not end in "_test". Point it at dietapp_test.',
  );
}
