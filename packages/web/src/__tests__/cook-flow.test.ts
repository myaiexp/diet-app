// Cook feedback modal: chip validation, as-is, skip and conflict handling.

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { openCookFlow, openFeedbackModal } from '../modals/cook-flow.js';
import { configureClient, resetClient } from '../api/client.js';
import { closeModal, isModalOpen } from '../ui/modal.js';
import type { MealPlanEntry } from '../api/types.js';

import {
  ENTRY,
  buildRouter,
  calledWith,
  lastBody,
  click,
  setFetchMock,
} from './cook-flow-test-helpers.js';

let fetchMock: Mock;

beforeEach(() => {
  document.body.replaceChildren();
  fetchMock = vi.fn();
  setFetchMock(fetchMock);
  configureClient({ fetch: fetchMock as unknown as typeof fetch });
});

afterEach(() => {
  resetClient();
  closeModal();
});

describe('cook feedback', () => {
  const cooked: MealPlanEntry = { ...ENTRY, status: 'cooked' };

  /** worth-it / effort / make-again chips, leaving only "as written" unset. */
  function selectBaseChips(): void {
    click('.cook-chip[data-value="thumbs_up"]');
    click('.cook-chip[data-value="felt_right"]');
    click('.cook-chip[data-value="yes"]');
  }

  test('requires changesNote when "changed it" is chosen, blocked client-side', async () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    selectBaseChips();
    click('.cook-chip[data-value="changed"]');

    const saveBtn = document.querySelector<HTMLButtonElement>('.cook-feedback-save')!;
    expect(saveBtn.disabled).toBe(true);
    saveBtn.click();
    expect(calledWith('/feedback')).toBe(false);

    const noteInput = document.querySelector<HTMLTextAreaElement>('.cook-changes-note')!;
    noteInput.value = 'halved the cream, added dill at the end';
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    await vi.waitFor(() => expect(calledWith('/feedback')).toBe(true));
    const body = lastBody('/feedback');
    expect(body['usedAsIs']).toBe(false);
    expect(body['changesNote']).toBe('halved the cream, added dill at the end');
  });

  test('omits changesNote entirely when "as-is" is chosen', async () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    selectBaseChips();
    click('.cook-chip[data-value="as_is"]');

    const saveBtn = document.querySelector<HTMLButtonElement>('.cook-feedback-save')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() => expect(calledWith('/feedback')).toBe(true));
    const body = lastBody('/feedback');
    expect(body['usedAsIs']).toBe(true);
    expect('changesNote' in body).toBe(false);
  });

  test('lets feedback be skipped without blocking', () => {
    fetchMock.mockImplementation(buildRouter());
    openFeedbackModal(cooked);

    expect(isModalOpen()).toBe(true);
    click('.cook-feedback-skip');
    expect(isModalOpen()).toBe(false);
    expect(calledWith('/feedback')).toBe(false);
  });

  test('a 409 on feedback save closes the modal, toasts, and still calls onDone', async () => {
    fetchMock.mockImplementation(buildRouter({ feedbackStatus: 409 }));
    const onEntryChanged = vi.fn();
    openCookFlow({ entry: ENTRY, onEntryChanged });

    await vi.waitFor(() => expect(document.querySelector('.cook-commit')).not.toBeNull());
    click('.cook-commit');

    await vi.waitFor(() => expect(document.querySelector('.cook-chip-row')).not.toBeNull());
    expect(onEntryChanged).toHaveBeenCalledOnce();

    selectBaseChips();
    click('.cook-chip[data-value="as_is"]');

    const saveBtn = document.querySelector<HTMLButtonElement>('.cook-feedback-save')!;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();

    await vi.waitFor(() =>
      expect(document.querySelector('.toast')?.textContent).toMatch(/already recorded/i),
    );
    expect(isModalOpen()).toBe(false);
    expect(onEntryChanged).toHaveBeenCalledTimes(2);
  });
});
