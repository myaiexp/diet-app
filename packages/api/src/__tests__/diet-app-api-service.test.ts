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

  test('denies link-local, RFC1918, CGNAT, and IPv6 ULA (finding #7854)', () => {
    const deny = unit.match(/^IPAddressDeny=(.+)$/m);
    expect(deny).not.toBeNull();
    const ranges = deny![1]!.split(/\s+/);
    for (const need of [
      '169.254.0.0/16',
      '10.0.0.0/8',
      '172.16.0.0/12',
      '192.168.0.0/16',
      '100.64.0.0/10',
      'fc00::/7',
      'fe80::/10',
      'fec0::/10',
    ]) {
      expect(ranges, need).toContain(need);
    }
    expect(ranges).not.toContain('127.0.0.0/8');
    expect(ranges).not.toContain('::1');
    expect(unit).not.toMatch(/Do not add IPAddressDeny/);
  });
});
