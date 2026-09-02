// Shared import input size budget (paste reject + URL truncate)

/** Max characters of recipe text accepted into the extraction model. */
export const IMPORT_TEXT_MAX_CHARS = 100_000;

/**
 * Below this many stripped characters, a fetched page is treated as low-yield:
 * a 200 that carried no recipe, which in practice means the page renders its
 * content with JavaScript and we sent the model a nav bar.
 *
 * Measured 2026-09-02 over live 200s from real recipe sites: kotikokki.net
 * stripped to 1026 characters, arla.fi 1989, bbcgoodfood 6340, valio.fi 7570.
 * A client-rendered shell is a `<div id="root">` and a spinner — a couple of
 * hundred at most. The floor sits between, nearer the shell, because the flag
 * is advisory (a warning and a log line, never a rejection) and a missed
 * detection is what leaves the failure silent.
 */
export const IMPORT_TEXT_MIN_CHARS = 600;
