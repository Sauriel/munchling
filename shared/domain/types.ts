// Persistence-independent application DTOs. Numeric IDs are local identities;
// the forthcoming sync protocol will use additional global UUIDs.
export type Profile = {
	id: number;
	revision?: number;
	name: string;
	dailyCaloriesTarget: number;
	dailyProteinTarget: number | null;
	dailyCarbsTarget: number | null;
	dailyFatTarget: number | null;
	dailySugarTarget: number | null;
	dailyFiberTarget: number | null;
	dailySaltTarget: number | null;
	createdAt: string;
	updatedAt: string | null;
};

export type CreateProfileInput = {
	name: string;
	dailyCaloriesTarget: number;
	dailyProteinTarget?: number | null;
	dailyCarbsTarget?: number | null;
	dailyFatTarget?: number | null;
	dailySugarTarget?: number | null;
	dailyFiberTarget?: number | null;
	dailySaltTarget?: number | null;
};
export type UpdateProfileInput = Partial<CreateProfileInput>;

export type Food = {
	id: number;
	revision?: number;
	nameDe: string;
	nameEn: string;
	brand: string | null;
	ean: string | null;
	caloriesPer100g: number;
	fatPer100g: number;
	carbsPer100g: number;
	sugarPer100g: number;
	fiberPer100g: number;
	proteinPer100g: number;
	saltPer100g: number;
	isCustom: boolean;
	portionSizeGrams?: number | null;
	createdAt: string;
	updatedAt: string | null;
};
export type CreateFoodInput = Omit<Food, "id" | "revision" | "createdAt" | "updatedAt" | "brand" | "ean" | "isCustom"> & {
	brand?: string | null;
	ean?: string | null;
	isCustom?: boolean;
};
export type UpdateFoodInput = Partial<CreateFoodInput>;

export type Recipe = {
	id: number;
	revision?: number;
	nameDe: string;
	nameEn: string;
	description: string | null;
	isSubRecipe: boolean;
	portionSizeGrams?: number | null;
	createdAt: string;
	updatedAt: string | null;
};
export type RecipeIngredient = {
	id: number;
	recipeId: number;
	foodId: number | null;
	subRecipeId: number | null;
	amountGrams: number;
	createdAt: string;
};
export type RecipeWithIngredients = Recipe & { ingredients: RecipeIngredient[] };
export type RecipeIngredientInput =
	| { foodId: number; subRecipeId?: never; amountGrams: number }
	| { foodId?: never; subRecipeId: number; amountGrams: number };
export type CreateRecipeInput = {
	nameDe: string;
	nameEn: string;
	description?: string | null;
	isSubRecipe?: boolean;
	portionSizeGrams?: number | null;
	ingredients?: RecipeIngredientInput[];
};
export type UpdateRecipeInput = Partial<CreateRecipeInput>;

export type NutritionValues = {
	calories: number;
	fat: number;
	carbs: number;
	sugar: number;
	fiber: number;
	protein: number;
	salt: number;
};
export type RecipeNutrition = {
	totalWeightGrams: number;
	total: NutritionValues;
	per100g: NutritionValues;
};

export type MealLogProfile = {
	id: number;
	mealLogId: number;
	profileId: number;
	profileName: string;
	portionFactor: number;
	portionGrams: number;
};
export type MealLog = {
	id: number;
	revision?: number;
	loggedAt: string;
	foodId: number | null;
	recipeId: number | null;
	totalWeightGrams: number;
	sourceName: string;
	sourceType: "food" | "recipe";
	createdAt: string;
	updatedAt: string | null;
	profiles: MealLogProfile[];
	nutritionPer100g: NutritionValues;
};
export type MealLogProfileInput = { profileId: number; portionGrams: number };
export type CreateMealLogInput = {
	loggedAt?: string | null;
	foodId?: number | null;
	recipeId?: number | null;
	profiles: MealLogProfileInput[];
};
export type UpdateMealLogInput = CreateMealLogInput;
export type MealLogFilter = { profileId?: number; date?: string };
