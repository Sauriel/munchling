import type { FoodMergeReview } from './food-merge';
import type { Activity, ActivityInput, ActivityLog, ActivityLogInput } from './activities';
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
	// Explicit online capability; absent on the offline SQLite adapter.
	foodMerges?: { preview(sourceId: number, targetId: number): Promise<FoodMergeReview>; commit(token: string, confirmed: boolean): Promise<void> };
	activities: {
		listActivities(): Promise<Activity[]>;
		getActivityById(id: number): Promise<Activity | null>;
		createActivity(input: ActivityInput): Promise<Activity | null>;
		updateActivity(id: number, input: ActivityInput, revision?: number): Promise<Activity | null>;
		deleteActivity(id: number, revision?: number): Promise<number>;
	};
	activityLogs: {
		listActivityLogs(): Promise<ActivityLog[]>;
		createActivityLogs(input: ActivityLogInput): Promise<ActivityLog[]>;
		deleteActivityLog(id: number, revision?: number): Promise<number>;
	};
	profiles: {
		listProfiles(): Promise<Profile[]>;
		getProfileById(id: number): Promise<Profile | null>;
		createProfile(input: CreateProfileInput): Promise<Profile | null>;
		updateProfile(id: number, input: UpdateProfileInput, revision?: number): Promise<Profile | null>;
		deleteProfile(id: number, revision?: number): Promise<number>;
	};
	foods: {
		listFoods(searchTerm?: string): Promise<Food[]>;
		getFoodById(id: number): Promise<Food | null>;
		getFoodByEan(ean: string): Promise<Food | null>;
		getFoodByNameDe(nameDe: string): Promise<Food | null>;
		createFood(input: CreateFoodInput): Promise<Food | null>;
		updateFood(id: number, input: UpdateFoodInput, revision?: number): Promise<Food | null>;
		deleteFood(id: number, revision?: number): Promise<number>;
	};
	recipes: {
		listRecipes(): Promise<Recipe[]>;
		getRecipeById(id: number): Promise<Recipe | null>;
		listRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]>;
		getRecipeWithIngredients(id: number): Promise<RecipeWithIngredients | null>;
		createRecipe(input: CreateRecipeInput): Promise<RecipeWithIngredients | null>;
		updateRecipe(id: number, input: UpdateRecipeInput, revision?: number): Promise<RecipeWithIngredients | null>;
		deleteRecipe(id: number, revision?: number): Promise<number>;
		addRecipeIngredient(recipeId: number, input: RecipeIngredientInput, revision?: number): Promise<RecipeIngredient | null>;
		getRecipeIngredientById(id: number): Promise<RecipeIngredient | null>;
		updateRecipeIngredient(id: number, input: RecipeIngredientInput, revision?: number): Promise<RecipeIngredient | null>;
		deleteRecipeIngredient(id: number, revision?: number): Promise<number>;
		replaceRecipeIngredients(recipeId: number, ingredients: RecipeIngredientInput[], revision?: number): Promise<RecipeIngredient[]>;
		calculateRecipeNutrition(recipeId: number): Promise<RecipeNutrition>;
	};
	mealLogs: {
		listMealLogs(options?: MealLogFilter): Promise<MealLog[]>;
		getMealLogById(id: number): Promise<MealLog | null>;
		createMealLog(input: CreateMealLogInput): Promise<MealLog | null>;
		updateMealLog(id: number, input: UpdateMealLogInput, revision?: number): Promise<MealLog | null>;
		deleteMealLog(id: number, revision?: number): Promise<number>;
	};
}
