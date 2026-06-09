export const DATABASE_NAME = "munchling";

export type DatabaseMigration = {
	version: number;
	name: string;
	statements: string;
};

export const schemaMigrations: DatabaseMigration[] = [
	{
		version: 1,
		name: "initial_schema",
		statements: `
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        daily_calories_target INTEGER NOT NULL,
        daily_protein_target REAL,
        daily_carbs_target REAL,
        daily_fat_target REAL,
        daily_sugar_target REAL,
        daily_fiber_target REAL,
        daily_salt_target REAL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        CHECK (daily_calories_target >= 0),
        CHECK (daily_protein_target IS NULL OR daily_protein_target >= 0),
        CHECK (daily_carbs_target IS NULL OR daily_carbs_target >= 0),
        CHECK (daily_fat_target IS NULL OR daily_fat_target >= 0),
        CHECK (daily_sugar_target IS NULL OR daily_sugar_target >= 0),
        CHECK (daily_fiber_target IS NULL OR daily_fiber_target >= 0),
        CHECK (daily_salt_target IS NULL OR daily_salt_target >= 0)
      );

      CREATE TABLE IF NOT EXISTS foods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_de TEXT NOT NULL,
        name_en TEXT NOT NULL,
        brand TEXT,
        ean TEXT UNIQUE,
        calories_per_100g REAL NOT NULL,
        fat_per_100g REAL NOT NULL,
        carbs_per_100g REAL NOT NULL,
        sugar_per_100g REAL NOT NULL,
        fiber_per_100g REAL NOT NULL,
        protein_per_100g REAL NOT NULL,
        salt_per_100g REAL NOT NULL,
        is_custom INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        CHECK (ean IS NULL OR length(trim(ean)) > 0),
        CHECK (calories_per_100g >= 0),
        CHECK (fat_per_100g >= 0),
        CHECK (carbs_per_100g >= 0),
        CHECK (sugar_per_100g >= 0),
        CHECK (fiber_per_100g >= 0),
        CHECK (protein_per_100g >= 0),
        CHECK (salt_per_100g >= 0),
        CHECK (is_custom IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_de TEXT NOT NULL,
        name_en TEXT NOT NULL,
        description TEXT,
        is_sub_recipe INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        CHECK (is_sub_recipe IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER NOT NULL,
        food_id INTEGER,
        sub_recipe_id INTEGER,
        amount_grams REAL NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
        FOREIGN KEY (sub_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        CHECK (amount_grams > 0),
        CHECK (recipe_id != sub_recipe_id),
        CHECK (
          (food_id IS NOT NULL AND sub_recipe_id IS NULL) OR
          (food_id IS NULL AND sub_recipe_id IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS meal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        food_id INTEGER,
        recipe_id INTEGER,
        total_weight_grams REAL NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME,
        FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        CHECK (total_weight_grams > 0),
        CHECK (
          (food_id IS NOT NULL AND recipe_id IS NULL) OR
          (food_id IS NULL AND recipe_id IS NOT NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS meal_log_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meal_log_id INTEGER NOT NULL,
        profile_id INTEGER NOT NULL,
        portion_factor REAL NOT NULL DEFAULT 1.0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON DELETE CASCADE,
        FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
        UNIQUE (meal_log_id, profile_id),
        CHECK (portion_factor > 0)
      );

      CREATE INDEX IF NOT EXISTS idx_foods_ean ON foods(ean);
      CREATE INDEX IF NOT EXISTS idx_foods_name_de ON foods(name_de);
      CREATE INDEX IF NOT EXISTS idx_foods_name_en ON foods(name_en);
      CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id ON recipe_ingredients(recipe_id);
      CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_food_id ON recipe_ingredients(food_id);
      CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_sub_recipe_id ON recipe_ingredients(sub_recipe_id);
      CREATE INDEX IF NOT EXISTS idx_meal_logs_logged_at ON meal_logs(logged_at);
      CREATE INDEX IF NOT EXISTS idx_meal_logs_food_id ON meal_logs(food_id);
      CREATE INDEX IF NOT EXISTS idx_meal_logs_recipe_id ON meal_logs(recipe_id);
      CREATE INDEX IF NOT EXISTS idx_meal_log_profiles_meal_log_id ON meal_log_profiles(meal_log_id);
      CREATE INDEX IF NOT EXISTS idx_meal_log_profiles_profile_id ON meal_log_profiles(profile_id);
    `,
	},
];
