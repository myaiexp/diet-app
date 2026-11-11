// Ingredient rows, Dairy: milk, cream, cheese, yoghurt, and plant milks

import { ingredient, type GeneratedIngredient } from './define.js';

export const dairy: GeneratedIngredient[] = [
  ingredient('milk', 'dairy', 'ml', { calories: 42, protein_g: 3.4, carbs_g: 5, fat_g: 1, fiber_g: 0 }, { aliases: ['maito'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('whole milk', 'dairy', 'ml', { calories: 61, protein_g: 3.2, carbs_g: 4.8, fat_g: 3.3, fiber_g: 0 }, { aliases: ['täysmaito'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('skim milk', 'dairy', 'ml', { calories: 34, protein_g: 3.4, carbs_g: 5, fat_g: 0.1, fiber_g: 0 }, { aliases: ['rasvaton maito'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('heavy cream', 'dairy', 'ml', { calories: 340, protein_g: 2, carbs_g: 2.8, fat_g: 36, fiber_g: 0 }, { aliases: ['kerma', 'vispikerma'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('sour cream', 'dairy', 'ml', { calories: 193, protein_g: 2.4, carbs_g: 4.6, fat_g: 19, fiber_g: 0 }, { aliases: ['smetana', 'hapankerma'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('cream cheese', 'dairy', 'g', { calories: 342, protein_g: 6, carbs_g: 4, fat_g: 34, fiber_g: 0 }, { aliases: ['tuorejuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('butter', 'dairy', 'g', { calories: 717, protein_g: 0.9, carbs_g: 0.1, fat_g: 81, fiber_g: 0 }, { aliases: ['voi'], tags: ['vegetarian', 'gluten-free'], staple: true }),
  ingredient('cheddar cheese', 'dairy', 'g', { calories: 403, protein_g: 25, carbs_g: 1.3, fat_g: 33, fiber_g: 0 }, { aliases: ['cheddar-juusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('mozzarella', 'dairy', 'g', { calories: 280, protein_g: 28, carbs_g: 3.1, fat_g: 17, fiber_g: 0 }, { aliases: ['mozzarella-juusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('parmesan', 'dairy', 'g', { calories: 431, protein_g: 38, carbs_g: 4.1, fat_g: 29, fiber_g: 0 }, { aliases: ['parmesaani'], tags: ['vegetarian', 'gluten-free', 'high-protein'], shelfLife: { fridge_days: 60, freezer_days: 180, pantry_days: null } }),
  ingredient('gouda cheese', 'dairy', 'g', { calories: 356, protein_g: 25, carbs_g: 2.2, fat_g: 27, fiber_g: 0 }, { aliases: ['gouda', 'goudajuusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('feta cheese', 'dairy', 'g', { calories: 264, protein_g: 14, carbs_g: 4.1, fat_g: 21, fiber_g: 0 }, { aliases: ['feta-juusto', 'fetajuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('goat cheese', 'dairy', 'g', { calories: 364, protein_g: 22, carbs_g: 0.1, fat_g: 30, fiber_g: 0 }, { aliases: ['vuohenjuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('blue cheese', 'dairy', 'g', { calories: 353, protein_g: 21, carbs_g: 2.3, fat_g: 29, fiber_g: 0 }, { aliases: ['sinihomejuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('ricotta', 'dairy', 'g', { calories: 174, protein_g: 11, carbs_g: 3, fat_g: 13, fiber_g: 0 }, { aliases: ['ricotta', 'ricottajuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('cottage cheese', 'dairy', 'g', { calories: 98, protein_g: 11, carbs_g: 3.4, fat_g: 4.3, fiber_g: 0 }, { aliases: ['raejuusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('swiss cheese', 'dairy', 'g', { calories: 380, protein_g: 27, carbs_g: 5.4, fat_g: 28, fiber_g: 0 }, { aliases: ['emmental'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('greek yogurt', 'dairy', 'g', { calories: 59, protein_g: 10, carbs_g: 3.6, fat_g: 0.4, fiber_g: 0 }, { aliases: ['kreikkalainen jogurtti'], tags: ['vegetarian', 'gluten-free', 'high-protein', 'fermented'] }),
  ingredient('plain yogurt', 'dairy', 'g', { calories: 61, protein_g: 3.5, carbs_g: 4.7, fat_g: 3.3, fiber_g: 0 }, { aliases: ['maustamaton jogurtti', 'jogurtti'], tags: ['vegetarian', 'gluten-free', 'fermented'] }),
  ingredient('kefir', 'dairy', 'ml', { calories: 63, protein_g: 3.3, carbs_g: 4.7, fat_g: 3.5, fiber_g: 0 }, { aliases: ['kefiiri'], tags: ['vegetarian', 'gluten-free', 'fermented'] }),
  ingredient('whipped cream', 'dairy', 'ml', { calories: 257, protein_g: 3.2, carbs_g: 12, fat_g: 22, fiber_g: 0 }, { aliases: ['kermavaahto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('mascarpone', 'dairy', 'g', { calories: 429, protein_g: 5, carbs_g: 4, fat_g: 44, fiber_g: 0 }, { aliases: ['mascarpone', 'mascarponejuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('quark', 'dairy', 'g', { calories: 67, protein_g: 12, carbs_g: 4, fat_g: 0.2, fiber_g: 0 }, { aliases: ['rahka'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('buttermilk', 'dairy', 'ml', { calories: 40, protein_g: 3.3, carbs_g: 4.8, fat_g: 0.9, fiber_g: 0 }, { aliases: ['piimä'], tags: ['vegetarian', 'gluten-free', 'fermented'] }),
  ingredient('condensed milk', 'dairy', 'ml', { calories: 321, protein_g: 8, carbs_g: 54, fat_g: 9, fiber_g: 0 }, { aliases: ['kondensoitu maito'], tags: ['vegetarian', 'gluten-free'], shelfLife: { fridge_days: 14, freezer_days: null, pantry_days: 365 } }),
  ingredient('evaporated milk', 'dairy', 'ml', { calories: 134, protein_g: 7, carbs_g: 10, fat_g: 8, fiber_g: 0 }, { aliases: ['haihdutettu maito'], tags: ['vegetarian', 'gluten-free'], shelfLife: { fridge_days: 5, freezer_days: null, pantry_days: 365 } }),

  // Plant milks (categorize as dairy alternative)
  ingredient('oat milk', 'dairy', 'ml', { calories: 47, protein_g: 1, carbs_g: 7, fat_g: 1.5, fiber_g: 0.8 }, { aliases: ['kauramaito', 'kaurajuoma'], tags: ['vegetarian', 'vegan', 'dairy-free'] }),
  ingredient('almond milk', 'dairy', 'ml', { calories: 15, protein_g: 0.6, carbs_g: 0.6, fat_g: 1.1, fiber_g: 0.2 }, { aliases: ['mantelimaito'], tags: ['vegetarian', 'vegan', 'dairy-free', 'gluten-free'] }),
  ingredient('soy milk', 'dairy', 'ml', { calories: 33, protein_g: 2.8, carbs_g: 1.2, fat_g: 1.8, fiber_g: 0.4 }, { aliases: ['soijamaito', 'soijajuoma'], tags: ['vegetarian', 'vegan', 'dairy-free', 'gluten-free'] }),
  ingredient('coconut milk', 'dairy', 'ml', { calories: 230, protein_g: 2.3, carbs_g: 6, fat_g: 24, fiber_g: 0 }, { aliases: ['kookosmaito'], tags: ['vegetarian', 'vegan', 'dairy-free', 'gluten-free'], shelfLife: { fridge_days: 5, freezer_days: 90, pantry_days: 365 } }),
  ingredient('coconut cream', 'dairy', 'ml', { calories: 330, protein_g: 3.6, carbs_g: 7, fat_g: 34, fiber_g: 0 }, { aliases: ['kookoskerma'], tags: ['vegetarian', 'vegan', 'dairy-free', 'gluten-free'], shelfLife: { fridge_days: 5, freezer_days: 90, pantry_days: 365 } }),

  // Assorted
  ingredient('halloumi', 'dairy', 'g', { calories: 321, protein_g: 22, carbs_g: 3, fat_g: 25, fiber_g: 0 }, { aliases: ['halloumi-juusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('brie', 'dairy', 'g', { calories: 334, protein_g: 21, carbs_g: 0.5, fat_g: 28, fiber_g: 0 }, { aliases: ['brie-juusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('camembert', 'dairy', 'g', { calories: 300, protein_g: 20, carbs_g: 0.5, fat_g: 24, fiber_g: 0 }, { aliases: ['camembert', 'camembertjuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('gruyere', 'dairy', 'g', { calories: 413, protein_g: 30, carbs_g: 0.4, fat_g: 32, fiber_g: 0 }, { aliases: ['gruyère', 'gruyerejuusto'], tags: ['vegetarian', 'gluten-free', 'high-protein'] }),
  ingredient('provolone', 'dairy', 'g', { calories: 352, protein_g: 26, carbs_g: 2.1, fat_g: 27, fiber_g: 0 }, { aliases: ['provolone', 'provolonejuusto'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('cream', 'dairy', 'ml', { calories: 195, protein_g: 2.1, carbs_g: 3.7, fat_g: 20, fiber_g: 0 }, { aliases: ['ruokakerma'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('creme fraiche', 'dairy', 'ml', { calories: 292, protein_g: 2.4, carbs_g: 3, fat_g: 30, fiber_g: 0 }, { aliases: ['creme fraiche', 'ranskankerma'], tags: ['vegetarian', 'gluten-free'] }),
  ingredient('skyr', 'dairy', 'g', { calories: 61, protein_g: 11, carbs_g: 4, fat_g: 0.2, fiber_g: 0 }, { aliases: ['skyr'], tags: ['vegetarian', 'gluten-free', 'high-protein', 'fermented'] }),
  ingredient('ghee', 'dairy', 'g', { calories: 900, protein_g: 0, carbs_g: 0, fat_g: 100, fiber_g: 0 }, { aliases: ['ghee-voi'], tags: ['vegetarian', 'gluten-free'], shelfLife: { fridge_days: 365, freezer_days: null, pantry_days: 180 } }),
];
