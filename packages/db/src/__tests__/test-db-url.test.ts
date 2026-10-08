// The test-database URL guard rejects production even when "_test" appears
// somewhere other than the database name.

import { describe, expect, test } from 'vitest';
import { assertTestDbUrl, resolveDbName } from '../test-db-url.js';

const REFUSED: Array<[string, string]> = [
  ['the user is dietapp_test and the database is prod', 'postgresql://dietapp_test@/dietapp?host=/var/run/postgresql'],
  ['_test is only in the password', 'postgresql://dietapp:secret_test@localhost:5432/dietapp'],
  ['_test is only in a query parameter', 'postgresql://dietapp:secret@localhost:5432/dietapp?application_name=dietapp_test'],
  ['the name does not contain dietapp at all', 'postgresql://mase@/postgres?host=/var/run/postgresql'],
  ['the URL has no database path', 'postgresql://mase@localhost'],
  ['the name contains _test but does not end with it', 'postgresql://mase@/dietapp_test_backup'],
];

describe('assertTestDbUrl', () => {
  test.each(REFUSED)('refuses when %s', (_label, url) => {
    expect(() => assertTestDbUrl(url)).toThrow(/does not end in "_test"/);
  });

  test('allows the socket-style dietapp_test URL the suites actually use', () => {
    expect(() =>
      assertTestDbUrl('postgresql://mase@/dietapp_test?host=/var/run/postgresql'),
    ).not.toThrow();
  });

  test('allows a host-style dietapp_test URL', () => {
    expect(() =>
      assertTestDbUrl('postgres://user:pass@host:5432/dietapp_test?sslmode=require'),
    ).not.toThrow();
  });

  test('the error names the database and not the URL', () => {
    const url = 'postgresql://dietapp:supersecret@localhost:5432/dietapp';
    expect(resolveDbName(url)).toBe('dietapp');
    expect(() => assertTestDbUrl(url)).toThrow(/database is "dietapp"/);
    try {
      assertTestDbUrl(url);
    } catch (err) {
      expect(String(err)).not.toContain('supersecret');
      expect(String(err)).not.toContain(url);
    }
  });
});
