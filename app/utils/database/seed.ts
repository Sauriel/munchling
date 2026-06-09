export const testDataSeedStatements = `
  INSERT INTO profiles (
    name,
    daily_calories_target,
    daily_protein_target,
    daily_carbs_target,
    daily_fat_target,
    daily_sugar_target,
    daily_fiber_target,
    daily_salt_target
  )
  SELECT 'Demo Profil', 2200, 120, 260, 75, 50, 30, 6
  WHERE NOT EXISTS (SELECT 1 FROM profiles LIMIT 1);

  INSERT INTO foods (
    name_de,
    name_en,
    brand,
    ean,
    calories_per_100g,
    fat_per_100g,
    carbs_per_100g,
    sugar_per_100g,
    fiber_per_100g,
    protein_per_100g,
    salt_per_100g,
    is_custom
  )
  SELECT 'Haferflocken', 'Oats', NULL, NULL, 372, 7.0, 59.0, 1.0, 10.0, 13.5, 0.02, 0
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE name_de = 'Haferflocken');

  INSERT INTO foods (
    name_de,
    name_en,
    brand,
    ean,
    calories_per_100g,
    fat_per_100g,
    carbs_per_100g,
    sugar_per_100g,
    fiber_per_100g,
    protein_per_100g,
    salt_per_100g,
    is_custom
  )
  SELECT 'Banane', 'Banana', NULL, NULL, 89, 0.3, 22.8, 12.2, 2.6, 1.1, 0.0, 0
  WHERE NOT EXISTS (SELECT 1 FROM foods WHERE name_de = 'Banane');

  INSERT INTO recipes (name_de, name_en, description, is_sub_recipe)
  SELECT 'Hafer-Bananen-Bowl', 'Oat banana bowl', 'Ein einfaches Demo-Gericht für die erste Datenbankprüfung.', 0
  WHERE NOT EXISTS (SELECT 1 FROM recipes WHERE name_de = 'Hafer-Bananen-Bowl');

  INSERT INTO recipe_ingredients (recipe_id, food_id, amount_grams)
  SELECT recipes.id, foods.id, 80
  FROM recipes, foods
  WHERE recipes.name_de = 'Hafer-Bananen-Bowl'
    AND foods.name_de = 'Haferflocken'
    AND NOT EXISTS (
      SELECT 1
      FROM recipe_ingredients
      WHERE recipe_id = recipes.id AND food_id = foods.id
    );

  INSERT INTO recipe_ingredients (recipe_id, food_id, amount_grams)
  SELECT recipes.id, foods.id, 120
  FROM recipes, foods
  WHERE recipes.name_de = 'Hafer-Bananen-Bowl'
    AND foods.name_de = 'Banane'
    AND NOT EXISTS (
      SELECT 1
      FROM recipe_ingredients
      WHERE recipe_id = recipes.id AND food_id = foods.id
    );
`;
