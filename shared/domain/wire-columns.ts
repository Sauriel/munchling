// Protocol-v1 field names only. No SQL, storage or platform dependencies.
export const wireColumns = {
	profiles: ["name", "daily_calories_target", "daily_protein_target", "daily_carbs_target", "daily_fat_target", "daily_sugar_target", "daily_fiber_target", "daily_salt_target", "created_at", "updated_at"],
	foods: ["name_de", "name_en", "brand", "ean", "calories_per_100g", "fat_per_100g", "carbs_per_100g", "sugar_per_100g", "fiber_per_100g", "protein_per_100g", "salt_per_100g", "is_custom", "portion_size_grams", "created_at", "updated_at"],
	recipes: ["name_de", "name_en", "description", "is_sub_recipe", "portion_size_grams", "created_at", "updated_at"],
	meal_logs: ["logged_at", "food_id", "recipe_id", "total_weight_grams", "created_at", "updated_at"],
	recipe_ingredients: ["recipe_id", "food_id", "sub_recipe_id", "amount_grams", "created_at"],
	meal_log_profiles: ["meal_log_id", "profile_id", "portion_factor", "created_at"],
} as const;
