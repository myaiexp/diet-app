// Ingredient rows, Frozen: vegetables, fruit, seafood, dough, ready products

import { ingredient, type GeneratedIngredient } from './define.js';

export const frozen: GeneratedIngredient[] = [
  ingredient('frozen peas', 'frozen', 'g', { calories: 77, protein_g: 5, carbs_g: 14, fat_g: 0.4, fiber_g: 4.5 }, { aliases: ['pakasteherneet'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen corn', 'frozen', 'g', { calories: 86, protein_g: 3.3, carbs_g: 19, fat_g: 1.2, fiber_g: 2.4 }, { aliases: ['pakastemaissi'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen spinach', 'frozen', 'g', { calories: 29, protein_g: 3.6, carbs_g: 4.1, fat_g: 0.5, fiber_g: 2.6 }, { aliases: ['pakastepinaatti'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen broccoli', 'frozen', 'g', { calories: 28, protein_g: 2.8, carbs_g: 5, fat_g: 0.3, fiber_g: 2.6 }, { aliases: ['pakasteparsakaali'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen green beans', 'frozen', 'g', { calories: 33, protein_g: 1.8, carbs_g: 7.1, fat_g: 0.2, fiber_g: 3.2 }, { aliases: ['pakastetut vihreät pavut'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen mixed vegetables', 'frozen', 'g', { calories: 65, protein_g: 3.3, carbs_g: 13, fat_g: 0.3, fiber_g: 3.7 }, { aliases: ['pakastevihannekset'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen strawberries', 'frozen', 'g', { calories: 35, protein_g: 0.4, carbs_g: 9, fat_g: 0.1, fiber_g: 2 }, { aliases: ['pakastemansikat'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen blueberries', 'frozen', 'g', { calories: 57, protein_g: 0.4, carbs_g: 14, fat_g: 0.5, fiber_g: 2.4 }, { aliases: ['pakastemustikat'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen raspberries', 'frozen', 'g', { calories: 52, protein_g: 0.7, carbs_g: 12, fat_g: 0.3, fiber_g: 6.5 }, { aliases: ['pakastevadelmat'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen mango', 'frozen', 'g', { calories: 60, protein_g: 0.4, carbs_g: 15, fat_g: 0.2, fiber_g: 1.6 }, { aliases: ['pakastemango'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen banana', 'frozen', 'g', { calories: 89, protein_g: 1.1, carbs_g: 23, fat_g: 0.3, fiber_g: 2.6 }, { aliases: ['pakastebanaani'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen edamame', 'frozen', 'g', { calories: 121, protein_g: 11, carbs_g: 10, fat_g: 5, fiber_g: 5 }, { aliases: ['pakaste-edamame'], tags: ['vegetarian', 'vegan', 'gluten-free', 'high-protein'] }),
  ingredient('frozen shrimp', 'frozen', 'g', { calories: 85, protein_g: 20, carbs_g: 0, fat_g: 0.5, fiber_g: 0 }, { aliases: ['pakastekatkaravut'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('frozen fish fillets', 'frozen', 'g', { calories: 86, protein_g: 17, carbs_g: 0, fat_g: 1.5, fiber_g: 0 }, { aliases: ['pakastekala'], tags: ['gluten-free', 'dairy-free', 'high-protein'] }),
  ingredient('frozen pizza dough', 'frozen', 'g', { calories: 249, protein_g: 7, carbs_g: 45, fat_g: 3.5, fiber_g: 1.5 }, { aliases: ['pizzataikina'], tags: ['vegetarian'] }),
  ingredient('frozen puff pastry', 'frozen', 'g', { calories: 558, protein_g: 7.5, carbs_g: 45, fat_g: 38, fiber_g: 1.5 }, { aliases: ['pakastelehtitaikina'], tags: ['vegetarian'] }),
  ingredient('frozen pie crust', 'frozen', 'g', { calories: 474, protein_g: 6, carbs_g: 45, fat_g: 31, fiber_g: 1.5 }, { aliases: ['piirakkapohja'], tags: ['vegetarian'] }),
  ingredient('frozen cauliflower', 'frozen', 'g', { calories: 23, protein_g: 2, carbs_g: 4.1, fat_g: 0.2, fiber_g: 2.2 }, { aliases: ['pakastekukkakaali'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen bell peppers', 'frozen', 'g', { calories: 20, protein_g: 0.9, carbs_g: 4.6, fat_g: 0.2, fiber_g: 1.7 }, { aliases: ['pakastepaprika', 'pakastettu paprika'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen berries mix', 'frozen', 'g', { calories: 48, protein_g: 0.6, carbs_g: 12, fat_g: 0.3, fiber_g: 3 }, { aliases: ['pakastemarjasekoitus'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('ice cream', 'frozen', 'g', { calories: 207, protein_g: 3.5, carbs_g: 24, fat_g: 11, fiber_g: 0.7 }, { aliases: ['jäätelö'], tags: ['vegetarian', 'gluten-free'] }),

  // Assorted
  ingredient('frozen artichoke hearts', 'frozen', 'g', { calories: 38, protein_g: 2.9, carbs_g: 8.6, fat_g: 0.2, fiber_g: 4.8 }, { aliases: ['artisokansydämet'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen sweet potato fries', 'frozen', 'g', { calories: 180, protein_g: 1.5, carbs_g: 30, fat_g: 6, fiber_g: 2.5 }, { aliases: ['bataattiranskalaiset'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen dumplings', 'frozen', 'g', { calories: 215, protein_g: 8, carbs_g: 30, fat_g: 7, fiber_g: 1.2 }, { aliases: ['nyytit', 'dumplingit'], tags: [] }),
  ingredient('frozen spring rolls', 'frozen', 'g', { calories: 225, protein_g: 5, carbs_g: 28, fat_g: 10, fiber_g: 1.5 }, { aliases: ['kevätrullat'], tags: ['vegetarian'] }),
  ingredient('frozen waffles', 'frozen', 'pieces', { calories: 312, protein_g: 6, carbs_g: 45, fat_g: 12, fiber_g: 1.5 }, { aliases: ['pakastevohvelit'], tags: ['vegetarian'] }),
  ingredient('frozen hash browns', 'frozen', 'g', { calories: 174, protein_g: 2, carbs_g: 24, fat_g: 8, fiber_g: 2 }, { aliases: ['perunarösti', 'röstiperuna'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen french fries', 'frozen', 'g', { calories: 150, protein_g: 2, carbs_g: 24, fat_g: 5, fiber_g: 2 }, { aliases: ['pakasteperunat'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen acai', 'frozen', 'g', { calories: 70, protein_g: 1, carbs_g: 4, fat_g: 5, fiber_g: 3 }, { aliases: ['acai', 'acaimarja'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
  ingredient('frozen cherries', 'frozen', 'g', { calories: 50, protein_g: 1, carbs_g: 12, fat_g: 0.3, fiber_g: 1.6 }, { aliases: ['pakastekirsikat'], tags: ['vegetarian', 'vegan', 'gluten-free'] }),
];
