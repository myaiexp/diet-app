// A 200 that yields almost no text is a JS-hydrated page, not a recipe

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchUrlAsText, IMPORT_TEXT_MIN_CHARS } from '../ai/fetch-url.js';
import { captureImportLogs, htmlResponse, publicDns } from './fetch-url-test-util.js';

let logged: string[] = [];

beforeEach(() => {
  logged = captureImportLogs().logged;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A client-rendered shell: the server sends 200 and the recipe never arrives. */
const HYDRATED_SHELL = `<!doctype html><html><head><title>Resepti</title>
  <script src="/app.js"></script></head>
  <body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>`;

/** A server-rendered page, padded past the floor the way a real one runs. */
const REAL_PAGE = `<html><body><h1>Lohikeitto</h1><p>${'Keitä perunat ja lohi. '.repeat(60)}</p></body></html>`;

const fetchOnce =
  (html: string): typeof fetch =>
  async () =>
    htmlResponse(html);

describe('low-yield extraction', () => {
  test('flags a 200 whose stripped text is implausibly short for a recipe', async () => {
    const result = await fetchUrlAsText('https://example.com/spa-recipe', {
      fetchImpl: fetchOnce(HYDRATED_SHELL),
      dnsLookup: publicDns,
    });

    // Still ok: nothing failed, and the caller may well want to try anyway.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.length).toBeLessThan(IMPORT_TEXT_MIN_CHARS);
    expect(result.lowYield).toBe(true);
  });

  test('logs the low yield, since nothing else in the chain would', async () => {
    await fetchUrlAsText('https://example.com/spa-recipe', {
      fetchImpl: fetchOnce(HYDRATED_SHELL),
      dnsLookup: publicDns,
    });

    const line = logged.find((l) => l.includes('low-yield extraction'));
    expect(line).toBeDefined();
    expect(line).toContain('example.com/spa-recipe');
    // The character count is the whole point of the log line — it is the
    // evidence that decides whether a headless-browser rung is worth building.
    expect(line).toMatch(/chars=\d+/);
  });

  test('leaves a real server-rendered recipe page alone', async () => {
    const result = await fetchUrlAsText('https://example.com/lohikeitto', {
      fetchImpl: fetchOnce(REAL_PAGE),
      dnsLookup: publicDns,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lowYield).toBe(false);
    expect(logged.some((l) => l.includes('low-yield'))).toBe(false);
  });

  test('the floor sits below every real recipe page measured', () => {
    // Measured 2026-09-02 over live 200s: kotikokki.net 1026 stripped chars,
    // arla.fi 1989, bbcgoodfood 6340, valio.fi 7570. The floor has to clear a
    // JS shell (a nav bar and a spinner) without ever tripping the smallest of
    // those, so it belongs well under 1026 — not tuned up toward it.
    expect(IMPORT_TEXT_MIN_CHARS).toBeLessThan(1026);
    expect(IMPORT_TEXT_MIN_CHARS).toBeGreaterThan(300);
  });
});
