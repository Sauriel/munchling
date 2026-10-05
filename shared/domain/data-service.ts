import type { LocalBackupService } from "./backup";
import type {
	CreateFoodInput, CreateMealLogInput, CreateProfileInput, CreateRecipeInput,
	Food, MealLog, MealLogFilter, Profile, Recipe, RecipeIngredient,
	RecipeIngredientInput, RecipeNutrition, RecipeWithIngredients,
	UpdateFoodInput, UpdateMealLogInput, UpdateProfileInput, UpdateRecipeInput,
} from "./types";

// UI-facing contract shared by the local SQLite and future HTTP adapters.
// Keep transport, SQL and Capacitor out of this module.
export interface MunchlingDataService {
	// Optional local capability; an online server adapter must not expose a
	// browser-side destructive restore against the shared server database.
	backups?: LocalBackupService;
	profiles: {
		listProfiles(): Promise<Profile[]>;
		getProfileById(id: number): Promise<Profile | null>;
		createProfile(input: CreateProfileInput): Promise<Profile | null>;
		updateProfile(id: number, input: UpdateProfileInput): Promise<Profile | null>;
		deleteProfile(id: number): Promise<number>;
	};
	foods: {
		listFoods(searchTerm?: string): Promise<Food[]>;
		getFoodById(id: number): Promise<Food | null>;
		getFoodByEan(ean: string): Promise<Food | null>;
		getFoodByNameDe(nameDe: string): Promise<Food | null>;
		createFood(input: CreateFoodInput): Promise<Food | null>;
		updateFood(id: number, input: UpdateFoodInput): Promise<Food | null>;
		deleteFood(id: number): Promise<number>;
	};
	recipes: {
		listRecipes(): Promise<Recipe[]>;
		getRecipeById(id: number): Promise<Recipe | null>;
		listRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]>;
		getRecipeWithIngredients(id: number): Promise<RecipeWithIngredients | null>;
		createRecipe(input: CreateRecipeInput): Promise<RecipeWithIngredients | null>;
		updateRecipe(id: number, input: UpdateRecipeInput): Promise<RecipeWithIngredients | null>;
		deleteRecipe(id: number): Promise<number>;
		addRecipeIngredient(recipeId: number, input: RecipeIngredientInput): Promise<RecipeIngredient | null>;
		getRecipeIngredientById(id: number): Promise<RecipeIngredient | null>;
		updateRecipeIngredient(id: number, input: RecipeIngredientInput): Promise<RecipeIngredient | null>;
		deleteRecipeIngredient(id: number): Promise<number>;
		replaceRecipeIngredients(recipeId: number, ingredients: RecipeIngredientInput[]): Promise<RecipeIngredient[]>;
		calculateRecipeNutrition(recipeId: number): Promise<RecipeNutrition>;
	};
	mealLogs: {
		listMealLogs(options?: MealLogFilter): Promise<MealLog[]>;
		getMealLogById(id: number): Promise<MealLog | null>;
		createMealLog(input: CreateMealLogInput): Promise<MealLog | null>;
		updateMealLog(id: number, input: UpdateMealLogInput): Promise<MealLog | null>;
		deleteMealLog(id: number): Promise<number>;
	};
}
