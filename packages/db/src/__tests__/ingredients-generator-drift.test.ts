// Guards that the committed ingredients.json is exactly what generate-ingredients.ts emits
import { describe, test, expect, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(__dirname, '..', '..');
const generator = join(pkgRoot, 'scripts', 'generate-ingredients.ts');
const committed = join(pkgRoot, 'data', 'ingredients.json');
const outDir = mkdtempSync(join(tmpdir(), 'ingredients-gen-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('ingredients.json vs its generator', () => {
  // The deploy seeds the committed JSON and never re-runs the generator, so an
  // edit to scripts/ingredients/ that is not regenerated would ship nothing — and a hand
  // edit to the JSON would be lost on the next `db:seed`.
  test('regenerating produces the committed file byte for byte', () => {
    const out = join(outDir, 'ingredients.json');
    // `--import tsx` rather than the tsx bin: no PATH or .bin lookup, same node.
    execFileSync(process.execPath, ['--import', 'tsx', generator, out], { stdio: 'pipe' });
    const regenerated = readFileSync(out, 'utf-8');
    expect(
      regenerated === readFileSync(committed, 'utf-8'),
      'packages/db/data/ingredients.json is out of date with scripts/ingredients/ — ' +
        'run `pnpm --filter @diet-app/db exec tsx scripts/generate-ingredients.ts` and commit both (never hand-edit the JSON)',
    ).toBe(true);
  });
});
