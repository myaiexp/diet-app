// Recipes screen: tag-filtered list (270px) + detail pane (1fr). The detail
// pane — servings scaler, ingredients/steps, edit/fork — lives in detail.ts.

import '../../css/recipes.css';
import type { Screen, ScreenContext } from '../../router.js';
import { listAllRecipes } from '../../api/recipes.js';
import { listAllPantry } from '../../api/pantry.js';
import type { Recipe, PantryItem } from '../../api/types.js';
import { el, button } from '../../ui/dom.js';
import { loadInto } from '../../ui/async.js';
import { userMessage, fieldErrors } from '../../api/errors.js';
import { say } from '../../ui/toast.js';
import { createRecipeDetail, type DetailHandle } from './detail.js';

const TAG_OPTIONS = ['quick', 'fish', 'vegetarian', 'oven', 'no-cook'];

function recipeMeta(r: Recipe): string {
  const parts: string[] = [];
  if (r.cuisineType) parts.push(r.cuisineType);
  if (r.effortScore !== null) parts.push(`effort ${r.effortScore}/5`);
  parts.push(`cooked ${r.timesCooked}×`);
  if (r.userRating !== null) parts.push(`★${r.userRating}`);
  return parts.join(' · ');
}

function recipeRow(r: Recipe, onSelect: (id: string) => void): HTMLElement {
  const row = button('recipe-row', '', () => onSelect(r.id), { 'data-id': r.id });
  row.append(
    el(
      'div',
      { class: 'recipe-row-top' },
      el('span', { class: 'recipe-row-title' }, r.title),
      el('span', { class: 'recipe-row-time' }, r.totalTime !== null ? `${r.totalTime} min` : '—'),
    ),
    el('div', { class: 'recipe-row-meta' }, recipeMeta(r)),
  );
  return row;
}

export function recipesScreen(): Screen {
  let detailHandle: DetailHandle | null = null;

  return {
    title: 'Recipes',
    unmount() {
      detailHandle?.destroy();
      detailHandle = null;
    },
    async mount(root: HTMLElement, ctx: ScreenContext) {
      const selectedTags = new Set<string>();
      let pantryById = new Map<string, PantryItem>();

      function markSelected(listPanel: HTMLElement, id: string): void {
        for (const rowEl of listPanel.querySelectorAll<HTMLElement>('.recipe-row')) {
          rowEl.classList.toggle('is-selected', rowEl.dataset['id'] === id);
        }
      }

      function tagChip(label: string, active: boolean, onClick: () => void): HTMLElement {
        return button(`chip${active ? ' is-on' : ''}`, label, onClick, { 'data-tag': label });
      }

      function renderList(listPanel: HTMLElement, recipes: Recipe[], onSelect: (id: string) => void): void {
        const chipRow = el(
          'div',
          { class: 'bar bar-wrap' },
          tagChip('all', selectedTags.size === 0, () => {
            selectedTags.clear();
            void retag(listPanel, onSelect);
          }),
          ...TAG_OPTIONS.map((tag) =>
            tagChip(tag, selectedTags.has(tag), () => {
              if (selectedTags.has(tag)) selectedTags.delete(tag);
              else selectedTags.add(tag);
              void retag(listPanel, onSelect);
            }),
          ),
        );
        const rows = el('div', { class: 'recipe-rows' });
        if (recipes.length === 0) {
          rows.appendChild(el('p', { class: 'helper' }, 'No recipes match this filter.'));
          detailHandle?.showEmpty('No recipe selected.');
        } else {
          for (const r of recipes) rows.appendChild(recipeRow(r, onSelect));
        }
        listPanel.replaceChildren(chipRow, rows);
      }

      async function retag(listPanel: HTMLElement, onSelect: (id: string) => void): Promise<void> {
        const tags = selectedTags.size ? [...selectedTags].join(',') : undefined;
        try {
          const recipes = await listAllRecipes(tags ? { tags } : {});
          renderList(listPanel, recipes, onSelect);
          if (recipes[0]) {
            onSelect(recipes[0].id);
            markSelected(listPanel, recipes[0].id);
          }
        } catch (err) {
          say(userMessage(err), 'error');
        }
      }

      function renderCollectionEmpty(): void {
        const panel = el(
          'div',
          { class: 'empty-state' },
          el('h1', {}, 'No recipes yet'),
          el(
            'p',
            { class: 'text-pretty' },
            'Import one from a URL, or add your first manually once you have a favourite to type in.',
          ),
        );
        const cta = button('btn btn-primary', 'import a recipe →', () => ctx.navigate('/import'));
        panel.appendChild(cta);
        root.replaceChildren(panel);
      }

      async function buildLayout(recipes: Recipe[]): Promise<void> {
        const listPanel = el('div', { class: 'panel recipe-list' });
        const detailPanel = el('div', { class: 'panel panel-pad' });
        root.replaceChildren(el('div', { class: 'recipes-screen' }, listPanel, detailPanel));

        detailHandle = createRecipeDetail(detailPanel, {
          pantryById,
          onForked: (created) => {
            void refreshAfterFork(listPanel, created.id);
          },
        });

        const onSelect = (id: string): void => {
          void detailHandle?.show(id);
          markSelected(listPanel, id);
        };
        renderList(listPanel, recipes, onSelect);
        await detailHandle.show(recipes[0]!.id);
        markSelected(listPanel, recipes[0]!.id);

        async function refreshAfterFork(panel: HTMLElement, selectId: string): Promise<void> {
          const tags = selectedTags.size ? [...selectedTags].join(',') : undefined;
          try {
            const refreshed = await listAllRecipes(tags ? { tags } : {});
            renderList(panel, refreshed, onSelect);
            await detailHandle?.show(selectId);
            markSelected(panel, selectId);
          } catch (err) {
            say(userMessage(err), 'error');
          }
        }
      }

      async function loadInitial(): Promise<void> {
        await loadInto({
          container: root,
          label: 'loading recipes…',
          isStale: () => ctx.isStale(),
          load: () => Promise.all([listAllRecipes(), listAllPantry()]),
          render: async ([recipes, pantry]) => {
            pantryById = new Map(pantry.map((p) => [p.ingredientId, p]));
            ctx.setSubtitle(`${recipes.length} in collection · filter by tag`);
            if (recipes.length === 0) {
              renderCollectionEmpty();
              return;
            }
            await buildLayout(recipes);
          },
          formatError: (err) => [userMessage(err), ...fieldErrors(err)].join(' '),
        });
      }

      await loadInitial();
    },
  };
}
