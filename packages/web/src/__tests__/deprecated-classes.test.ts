// No web source uses base.css's deprecated .btn-sm / .btn-ghost (mase.fi buttons card, Legacy).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

// String in, string out: jsdom replaces the global URL, and fileURLToPath rejects its instances.
const THIS_FILE = fileURLToPath(import.meta.url);
const WEB = join(dirname(THIS_FILE), '..', '..');
// Built from parts so this file does not match its own scan.
const DEPRECATED = new RegExp(`\\bbtn-(${['sm', 'ghost'].join('|')})\\b`);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : sources(path);
    return /\.(ts|css|html)$/.test(entry.name) ? [path] : [];
  });
}

describe('deprecated button classes', () => {
  test('no source under packages/web uses .btn-sm or .btn-ghost', () => {
    const hits = [...sources(join(WEB, 'src')), join(WEB, 'index.html')]
      .filter((path) => path !== THIS_FILE)
      .flatMap((path) =>
        readFileSync(path, 'utf8')
          .split('\n')
          .flatMap((line, i) => (DEPRECATED.test(line) ? [`${relative(WEB, path)}:${i + 1}`] : [])),
      );
    expect(hits).toEqual([]);
  });
});
