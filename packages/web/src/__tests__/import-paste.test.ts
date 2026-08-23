// Import paste stage: empty submit, paste-only vs URL, URL-wins, extract cancel.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { configureClient, resetClient } from '../api/client.js';
import { importScreen } from '../screens/import/index.js';
import { jsonResponse, makeCtx, mountRoot, pathOf } from './harness.js';
import { makeDraft } from './fixtures.js';

function extractBtn(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('.import-paste .btn-primary')!;
}

function fillUrl(root: HTMLElement, url: string): void {
  const input = root.querySelector<HTMLInputElement>('.import-paste input')!;
  input.value = url;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function fillText(root: HTMLElement, text: string): void {
  const area = root.querySelector<HTMLTextAreaElement>('.import-paste-text')!;
  area.value = text;
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

function importBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        pathOf(String(url)) === '/api/recipes/import' &&
        ((init as RequestInit | undefined)?.method ?? 'GET') === 'POST',
    )
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
}

async function waitForReview(root: HTMLElement): Promise<void> {
  await vi.waitFor(() => expect(root.querySelector('.import-review')).not.toBeNull());
}

function pendingExtract(): {
  finish: (value: Response) => void;
  settled: () => boolean;
  fetch: (url: string) => Promise<Response>;
} {
  let finish: (value: Response) => void = () => {};
  let settled = false;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  return {
    finish: (value) => finish(value),
    settled: () => settled,
    fetch: async (url: string) => {
      if (pathOf(url) === '/api/recipes/import') {
        try {
          return await pending;
        } finally {
          settled = true;
        }
      }
      return jsonResponse(404, { error: 'unhandled' });
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => resetClient());

describe('import paste stage', () => {
  test('empty submit shows the client-side message and does not fetch', async () => {
    const root = mountRoot();
    await importScreen().mount(root, makeCtx());

    extractBtn(root).click();

    expect(root.querySelector('.import-paste')).not.toBeNull();
    expect(root.querySelector('.error-panel')?.textContent).toContain('Enter a URL or paste recipe text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('whitespace-only submit is empty — no fetch', async () => {
    const root = mountRoot();
    await importScreen().mount(root, makeCtx());

    fillUrl(root, '   ');
    fillText(root, '\n\t  ');
    extractBtn(root).click();

    expect(root.querySelector('.error-panel')?.textContent).toContain('Enter a URL or paste recipe text');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('paste-only sends { text }', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/recipes/import') return jsonResponse(200, { draft: makeDraft(), unmatchedCount: 0 });
      if (pathOf(url) === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    fillText(root, '1 kg perunaa\npaista');
    extractBtn(root).click();
    await waitForReview(root);

    expect(importBodies(fetchMock)).toEqual([{ text: '1 kg perunaa\npaista' }]);
  });

  test('URL plus paste sends { url } — the URL wins', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (pathOf(url) === '/api/recipes/import') return jsonResponse(200, { draft: makeDraft(), unmatchedCount: 0 });
      if (pathOf(url) === '/api/ingredients') return jsonResponse(200, []);
      return jsonResponse(404, { error: 'unhandled' });
    });

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    fillUrl(root, 'https://example.com/recipe');
    fillText(root, 'this text must not be sent');
    extractBtn(root).click();
    await waitForReview(root);

    expect(importBodies(fetchMock)).toEqual([{ url: 'https://example.com/recipe' }]);
  });

  test('cancel on extracting drops a late extract — stage stays paste, not review', async () => {
    const extract = pendingExtract();
    fetchMock.mockImplementation(extract.fetch);

    const root = mountRoot();
    await importScreen().mount(root, makeCtx());
    fillUrl(root, 'https://example.com/recipe');
    extractBtn(root).click();

    expect(root.querySelector('.import-extracting')).not.toBeNull();
    const cancel = [...root.querySelectorAll<HTMLButtonElement>('.import-extracting button')].find(
      (b) => b.textContent === 'cancel',
    )!;
    cancel.click();

    expect(root.querySelector('.import-paste')).not.toBeNull();
    expect(root.querySelector('.import-extracting')).toBeNull();
    expect(root.querySelector('.import-review')).toBeNull();

    extract.finish(jsonResponse(200, { draft: makeDraft(), unmatchedCount: 0 }));
    await vi.waitFor(() => expect(extract.settled()).toBe(true));

    expect(root.querySelector('.import-paste')).not.toBeNull();
    expect(root.querySelector('.import-review')).toBeNull();
  });

  test('unmount mid-extract drops a late extract so it cannot paint review', async () => {
    const extract = pendingExtract();
    fetchMock.mockImplementation(extract.fetch);

    const root = mountRoot();
    const screen = importScreen();
    await screen.mount(root, makeCtx());
    fillUrl(root, 'https://example.com/recipe');
    extractBtn(root).click();
    expect(root.querySelector('.import-extracting')).not.toBeNull();

    screen.unmount!();
    extract.finish(jsonResponse(200, { draft: makeDraft(), unmatchedCount: 0 }));
    await vi.waitFor(() => expect(extract.settled()).toBe(true));

    expect(root.querySelector('.import-review')).toBeNull();
  });
});
