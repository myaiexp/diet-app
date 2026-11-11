// Ingredient rows, Protein: poultry, meat, seafood, eggs, plant proteins

import { ingredient, type GeneratedIngredient } from './define.js';

export const protein: GeneratedIngredient[] = [
  // Poultry
  ingredient('chicken breast', 'protein', 'g', { calories: 165, protein_g: 31, carbs_g: 0, fat_g: 3.6, fiber_g: 0 }, { aliases: ['kanan rinta', 'broilerin rinta'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('chicken thigh', 'protein', 'g', { calories: 209, protein_g: 26, carbs_g: 0, fat_g: 11, fiber_g: 0 }, { aliases: ['kanan reisi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('chicken wing', 'protein', 'g', { calories: 203, protein_g: 30, carbs_g: 0, fat_g: 8, fiber_g: 0 }, { aliases: ['kanan siipi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('chicken', 'protein', 'g', { calories: 239, protein_g: 27, carbs_g: 0, fat_g: 14, fiber_g: 0 }, { aliases: ['kana', 'broileri'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('turkey breast', 'protein', 'g', { calories: 135, protein_g: 30, carbs_g: 0, fat_g: 1, fiber_g: 0 }, { aliases: ['kalkkunan rinta'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('turkey', 'protein', 'g', { calories: 189, protein_g: 29, carbs_g: 0, fat_g: 7, fiber_g: 0 }, { aliases: ['kalkkuna'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('duck breast', 'protein', 'g', { calories: 201, protein_g: 23, carbs_g: 0, fat_g: 11, fiber_g: 0 }, { aliases: ['ankan rinta'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),

  // Beef
  ingredient('beef steak', 'protein', 'g', { calories: 271, protein_g: 26, carbs_g: 0, fat_g: 18, fiber_g: 0 }, { aliases: ['pihvi', 'naudanliha pihvi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('ground beef', 'protein', 'g', { calories: 254, protein_g: 17, carbs_g: 0, fat_g: 20, fiber_g: 0 }, { aliases: ['jauheliha', 'naudan jauheliha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('beef roast', 'protein', 'g', { calories: 250, protein_g: 26, carbs_g: 0, fat_g: 16, fiber_g: 0 }, { aliases: ['naudanpaisti'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('beef short ribs', 'protein', 'g', { calories: 295, protein_g: 20, carbs_g: 0, fat_g: 23, fiber_g: 0 }, { aliases: ['naudan lyhytkylki', 'short ribs'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('beef liver', 'protein', 'g', { calories: 135, protein_g: 20, carbs_g: 4, fat_g: 3.6, fiber_g: 0 }, { aliases: ['naudanmaksa'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),

  // Pork
  ingredient('pork chop', 'protein', 'g', { calories: 231, protein_g: 25, carbs_g: 0, fat_g: 14, fiber_g: 0 }, { aliases: ['porsaankyljys'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('pork tenderloin', 'protein', 'g', { calories: 143, protein_g: 26, carbs_g: 0, fat_g: 3.5, fiber_g: 0 }, { aliases: ['porsaan sisäfilee'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('ground pork', 'protein', 'g', { calories: 263, protein_g: 17, carbs_g: 0, fat_g: 21, fiber_g: 0 }, { aliases: ['sian jauheliha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('bacon', 'protein', 'g', { calories: 541, protein_g: 37, carbs_g: 1.4, fat_g: 42, fiber_g: 0 }, { aliases: ['pekoni'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('ham', 'protein', 'g', { calories: 145, protein_g: 21, carbs_g: 1.5, fat_g: 6, fiber_g: 0 }, { aliases: ['kinkku'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('pork belly', 'protein', 'g', { calories: 518, protein_g: 9, carbs_g: 0, fat_g: 53, fiber_g: 0 }, { aliases: ['possun kylki'], tags: ['gluten-free', 'dairy-free'] }),
  ingredient('sausage', 'protein', 'g', { calories: 301, protein_g: 12, carbs_g: 2, fat_g: 27, fiber_g: 0 }, { aliases: ['makkara'], tags: ['dairy-free'] }),

  // Lamb
  ingredient('lamb chop', 'protein', 'g', { calories: 294, protein_g: 25, carbs_g: 0, fat_g: 21, fiber_g: 0 }, { aliases: ['lampaankyljys'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('lamb leg', 'protein', 'g', { calories: 258, protein_g: 25, carbs_g: 0, fat_g: 17, fiber_g: 0 }, { aliases: ['lampaan reisi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('ground lamb', 'protein', 'g', { calories: 282, protein_g: 17, carbs_g: 0, fat_g: 23, fiber_g: 0 }, { aliases: ['lampaan jauheliha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),

  // Fish & Seafood
  ingredient('salmon', 'protein', 'g', { calories: 208, protein_g: 20, carbs_g: 0, fat_g: 13, fiber_g: 0 }, { aliases: ['lohi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('tuna', 'protein', 'g', { calories: 132, protein_g: 28, carbs_g: 0, fat_g: 1.3, fiber_g: 0 }, { aliases: ['tonnikala'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('cod', 'protein', 'g', { calories: 82, protein_g: 18, carbs_g: 0, fat_g: 0.7, fiber_g: 0 }, { aliases: ['turska'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('shrimp', 'protein', 'g', { calories: 99, protein_g: 24, carbs_g: 0.2, fat_g: 0.3, fiber_g: 0 }, { aliases: ['katkarapu'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('trout', 'protein', 'g', { calories: 148, protein_g: 21, carbs_g: 0, fat_g: 6.6, fiber_g: 0 }, { aliases: ['taimen', 'kirjolohi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('mackerel', 'protein', 'g', { calories: 205, protein_g: 19, carbs_g: 0, fat_g: 14, fiber_g: 0 }, { aliases: ['makrilli'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('sardine', 'protein', 'g', { calories: 208, protein_g: 25, carbs_g: 0, fat_g: 11, fiber_g: 0 }, { aliases: ['sardiini'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('herring', 'protein', 'g', { calories: 158, protein_g: 18, carbs_g: 0, fat_g: 9, fiber_g: 0 }, { aliases: ['silli', 'silakka'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('pike-perch', 'protein', 'g', { calories: 84, protein_g: 19, carbs_g: 0, fat_g: 0.8, fiber_g: 0 }, { aliases: ['kuha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('perch', 'protein', 'g', { calories: 91, protein_g: 19, carbs_g: 0, fat_g: 1.2, fiber_g: 0 }, { aliases: ['ahven'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('crab', 'protein', 'g', { calories: 97, protein_g: 19, carbs_g: 0, fat_g: 1.5, fiber_g: 0 }, { aliases: ['rapu'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('mussel', 'protein', 'g', { calories: 86, protein_g: 12, carbs_g: 3.7, fat_g: 2.2, fiber_g: 0 }, { aliases: ['sinisimpukka'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('squid', 'protein', 'g', { calories: 92, protein_g: 16, carbs_g: 3.1, fat_g: 1.4, fiber_g: 0 }, { aliases: ['kalmari'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('smoked salmon', 'protein', 'g', { calories: 117, protein_g: 18, carbs_g: 0, fat_g: 4.3, fiber_g: 0 }, { aliases: ['savulohi'], tags: ['gluten-free', 'dairy-free', 'high-protein'], shelfLife: { fridge_days: 7, freezer_days: 90, pantry_days: null } }),
  ingredient('anchovies', 'protein', 'g', { calories: 131, protein_g: 20, carbs_g: 0, fat_g: 4.8, fiber_g: 0 }, { aliases: ['anjovikset', 'sardelli'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),

  // Eggs
  ingredient('egg', 'protein', 'pieces', { calories: 155, protein_g: 13, carbs_g: 1.1, fat_g: 11, fiber_g: 0 }, { aliases: ['kananmuna', 'muna'], tags: ['vegetarian', 'gluten-free', 'high-protein'], shelfLife: { fridge_days: 28, freezer_days: 365, pantry_days: null } }),

  // Plant proteins
  ingredient('tofu', 'protein', 'g', { calories: 76, protein_g: 8, carbs_g: 1.9, fat_g: 4.8, fiber_g: 0.3 }, { aliases: ['soijapapu'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'] }),
  ingredient('tempeh', 'protein', 'g', { calories: 192, protein_g: 20, carbs_g: 7.6, fat_g: 11, fiber_g: 0 }, { aliases: ['tempeh'], tags: ['vegetarian', 'vegan', 'high-protein'] }),
  ingredient('seitan', 'protein', 'g', { calories: 370, protein_g: 75, carbs_g: 14, fat_g: 2, fiber_g: 0.6 }, { aliases: ['seitan'], tags: ['vegetarian', 'vegan', 'high-protein'] }),
  ingredient('lentils', 'protein', 'g', { calories: 116, protein_g: 9, carbs_g: 20, fat_g: 0.4, fiber_g: 7.9 }, { aliases: ['linssit'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('chickpeas', 'protein', 'g', { calories: 164, protein_g: 8.9, carbs_g: 27, fat_g: 2.6, fiber_g: 7.6 }, { aliases: ['kikherneet'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('black beans', 'protein', 'g', { calories: 132, protein_g: 8.9, carbs_g: 24, fat_g: 0.5, fiber_g: 8.7 }, { aliases: ['mustat pavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('kidney beans', 'protein', 'g', { calories: 127, protein_g: 8.7, carbs_g: 23, fat_g: 0.5, fiber_g: 6.4 }, { aliases: ['kidneypavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('white beans', 'protein', 'g', { calories: 139, protein_g: 9.7, carbs_g: 25, fat_g: 0.4, fiber_g: 6.3 }, { aliases: ['valkoiset pavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('edamame', 'protein', 'g', { calories: 121, protein_g: 11, carbs_g: 9, fat_g: 5, fiber_g: 5.2 }, { aliases: ['edamame', 'edamamepavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'] }),
  ingredient('soybeans', 'protein', 'g', { calories: 173, protein_g: 17, carbs_g: 10, fat_g: 9, fiber_g: 6 }, { aliases: ['soijapavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),

  // Assorted
  ingredient('venison', 'protein', 'g', { calories: 158, protein_g: 30, carbs_g: 0, fat_g: 3.2, fiber_g: 0 }, { aliases: ['hirvenliha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('rabbit', 'protein', 'g', { calories: 197, protein_g: 29, carbs_g: 0, fat_g: 8, fiber_g: 0 }, { aliases: ['kaniini'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('elk', 'protein', 'g', { calories: 146, protein_g: 30, carbs_g: 0, fat_g: 2.4, fiber_g: 0 }, { aliases: ['hirvi'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('reindeer', 'protein', 'g', { calories: 155, protein_g: 30, carbs_g: 0, fat_g: 3.6, fiber_g: 0 }, { aliases: ['poro', 'poronliha'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('prosciutto', 'protein', 'g', { calories: 195, protein_g: 26, carbs_g: 0, fat_g: 10, fiber_g: 0 }, { aliases: ['prosciutto', 'ilmakuivattu kinkku'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('chorizo', 'protein', 'g', { calories: 455, protein_g: 24, carbs_g: 2, fat_g: 38, fiber_g: 0 }, { aliases: ['chorizo', 'chorizomakkara'], tags: ['dairy-free'] }),
  ingredient('salami', 'protein', 'g', { calories: 378, protein_g: 22, carbs_g: 2, fat_g: 31, fiber_g: 0 }, { aliases: ['salami', 'salamimakkara'], tags: ['dairy-free'] }),
  ingredient('pepperoni', 'protein', 'g', { calories: 504, protein_g: 22, carbs_g: 4, fat_g: 44, fiber_g: 0 }, { aliases: ['pepperoni', 'pepperonimakkara'], tags: ['dairy-free'] }),
  ingredient('canned sardines', 'protein', 'g', { calories: 208, protein_g: 25, carbs_g: 0, fat_g: 11, fiber_g: 0 }, { aliases: ['sardiinisailyke'], tags: ['gluten-free', 'dairy-free', 'high-protein'], shelfLife: { fridge_days: 3, freezer_days: null, pantry_days: 1095 } }),
  ingredient('octopus', 'protein', 'g', { calories: 82, protein_g: 15, carbs_g: 2.2, fat_g: 1, fiber_g: 0 }, { aliases: ['mustekala'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('scallop', 'protein', 'g', { calories: 111, protein_g: 21, carbs_g: 5, fat_g: 0.8, fiber_g: 0 }, { aliases: ['kampasimpukka'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('lobster', 'protein', 'g', { calories: 89, protein_g: 19, carbs_g: 0.5, fat_g: 0.9, fiber_g: 0 }, { aliases: ['hummeri'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('clam', 'protein', 'g', { calories: 74, protein_g: 13, carbs_g: 2.6, fat_g: 1, fiber_g: 0 }, { aliases: ['simpukka', 'venussimpukka'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('whitefish', 'protein', 'g', { calories: 90, protein_g: 19, carbs_g: 0, fat_g: 1.3, fiber_g: 0 }, { aliases: ['siika'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('halibut', 'protein', 'g', { calories: 111, protein_g: 23, carbs_g: 0, fat_g: 1.6, fiber_g: 0 }, { aliases: ['ruijanpallas', 'pallas'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('tilapia', 'protein', 'g', { calories: 96, protein_g: 20, carbs_g: 0, fat_g: 1.7, fiber_g: 0 }, { aliases: ['tilapia'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('split peas', 'protein', 'g', { calories: 118, protein_g: 8.3, carbs_g: 21, fat_g: 0.4, fiber_g: 8.3 }, { aliases: ['halkaistu herne'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein', 'high-fiber'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('fava beans', 'protein', 'g', { calories: 110, protein_g: 7.6, carbs_g: 19, fat_g: 0.4, fiber_g: 5.4 }, { aliases: ['haerkaepavut'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
  ingredient('mung beans', 'protein', 'g', { calories: 105, protein_g: 7, carbs_g: 19, fat_g: 0.4, fiber_g: 7.6 }, { aliases: ['mungopapu'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'], shelfLife: { fridge_days: 5, freezer_days: 180, pantry_days: 730 } }),
];
