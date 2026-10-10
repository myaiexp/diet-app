// Pins systemd/diet-app-api.service sandbox (finding #7853, finding #7854)
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const unit = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../../systemd/diet-app-api.service'),
  'utf8',
);

describe('systemd/diet-app-api.service sandbox', () => {
  test('hides $HOME except the diet-app tree (finding #7853)', () => {
    expect(unit).toMatch(/^ProtectSystem=strict$/m);
    expect(unit).toMatch(/^ProtectHome=tmpfs$/m);
    expect(unit).not.toMatch(/^ProtectHome=read-only$/m);
    expect(unit).toMatch(
      /^BindReadOnlyPaths=\/home\/mase\/Projects\/diet-app$/m,
    );
    expect(unit).toMatch(/^PrivateTmp=yes$/m);
    expect(unit).toMatch(/^NoNewPrivileges=yes$/m);
  });

  // Every non-routable range the recipe-import blocklist (ai/ssrf-host.ts)
  // refuses, minus loopback (finding #7854, finding #12748). 0.0.0.0/8 matters
  // most: a connect to 0.0.0.0 lands on 127.0.0.1, i.e. Postgres and nginx.
  test('denies the import blocklist ranges except loopback', () => {
    const deny = unit.match(/^IPAddressDeny=(.+)$/m);
    expect(deny).not.toBeNull();
    const ranges = deny![1]!.split(/\s+/);
    for (const need of [
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '224.0.0.0/4',
      '240.0.0.0/4',
      'fc00::/7',
      'fe80::/10',
      'fec0::/10',
      'ff00::/8',
      '2002::/16',
      '2001::/32',
      '64:ff9b:1::/48',
    ]) {
      expect(ranges, need).toContain(need);
    }
    expect(ranges).not.toContain('127.0.0.0/8');
    expect(ranges).not.toContain('::1');
    expect(unit).not.toMatch(/Do not add IPAddressDeny/);
  });
});
