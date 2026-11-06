// scripts/healthcheck.sh — the exit codes helm deploy's health gate keys its rollback on
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'child_process';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'scripts', 'healthcheck.sh');

// What the fake /api/health answers next: status + raw body.
let reply: { status: number; body: string } = { status: 200, body: '' };
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// Async on purpose: a sync spawn blocks this process's event loop, so the fake
// server above could never answer the script's curl.
function run(args: string[], healthUrl = url): Promise<number | null> {
  return new Promise((resolve) => {
    const child = execFile(script, args, {
      env: { ...process.env, DIET_APP_HEALTH_URL: healthUrl },
      timeout: 15_000,
    });
    child.on('exit', (code) => resolve(code));
  });
}

const healthy = JSON.stringify({ ok: true, name: 'diet-app-api', db: 'ok' });
const dbDown = JSON.stringify({ ok: false, name: 'diet-app-api', db: 'unreachable' });

describe('scripts/healthcheck.sh', () => {
  test('exits 0 on 200 { ok: true }, with or without the EXPECTED_SHA the gate passes', async () => {
    reply = { status: 200, body: healthy };
    expect(await run([])).toBe(0);
    // /api/health reports no sha, so any sha is accepted rather than compared.
    expect(await run(['0123456789abcdef0123456789abcdef01234567'])).toBe(0);
  });

  test('exits 1 when the API answers 503 because Postgres does not', async () => {
    reply = { status: 503, body: dbDown };
    expect(await run([])).toBe(1);
    expect(await run(['--sha'])).toBe(1);
  });

  test('exits 1 on a 200 that does not say ok: true', async () => {
    reply = { status: 200, body: dbDown };
    expect(await run([])).toBe(1);
    reply = { status: 200, body: '<html>proxy page</html>' };
    expect(await run([])).toBe(1);
  });

  test('exits 1 when nothing listens', async () => {
    expect(await run([], 'http://127.0.0.1:1/api/health')).toBe(1);
  });

  test('--sha exits 0 while up, since there is no served sha to print', async () => {
    reply = { status: 200, body: healthy };
    expect(await run(['--sha'])).toBe(0);
  });
});
