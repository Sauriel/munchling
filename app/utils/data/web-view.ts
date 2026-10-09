import type { Activity, ActivityLog } from '../../../shared/domain/activities';
import type { WebState } from "../../../shared/domain/web";
import type { SyncEntity, SyncAggregate } from "../../../shared/domain/sync";
import type { Profile, Food, RecipeWithIngredients, RecipeIngredient, MealLog, MealLogFilter } from "../../../shared/domain/types";
import { calculateRecipeNutrition, foodNutrition } from "../../../shared/domain/nutrition";
import { SyncClientError } from "../../../shared/domain/replies";
export function createWebView(state: WebState) {
	const ids = new Map(state.viewIds.map(row => [row.uuid, row.id])), aliases = new Map(state.viewIds.map(row => [`${row.entity}:${row.id}`, row.uuid]));
	const roots = new Map(state.snapshot.aggregates.map(root => [root.id, root]));
	const id = (uuid: unknown): number => { const value = ids.get(String(uuid)); if (!value) throw new SyncClientError("invalidResponse"); return value; };
	const ref = (uuid: unknown) => uuid === null ? null : id(uuid);
	const uuid = (entity: SyncEntity, value: number): string => { const key = aliases.get(`${entity}:${value}`); if (!key) throw new SyncClientError("reference"); return key; };
	function root(entity: SyncAggregate, value: number) { const row = roots.get(uuid(entity, value)); if (!row || row.entity !== entity || row.data === null) throw new SyncClientError("reference"); return row; }
	const common = (row: { id: string; version: number; data: Record<string, unknown> | null }) => ({ id: id(row.id), revision: row.version, createdAt: String(row.data!.created_at), updatedAt: row.data!.updated_at as string | null });
	const activities = new Map<number, Activity>(), activityLogs = new Map<number, ActivityLog>();
	const profiles = new Map<number, Profile>(); const foods = new Map<number, Food>(); const recipes = new Map<number, RecipeWithIngredients>();
	for (const row of roots.values()) {
		if (!row.data) continue; const d = row.data;
		if (row.entity === 'activities' || row.entity === 'activity_logs') {
			const activity = { ...common(row), name: String(d.name), durationMinutes: Number(d.duration_minutes), calories: Number(d.calories) };
			if (row.entity === 'activities') activities.set(id(row.id), activity);
			else activityLogs.set(id(row.id), { ...activity, profileId: id(d.profile_id), date: String(d.date), units: Number(d.units) });
		}
		if (row.entity === "profiles") profiles.set(id(row.id), { ...common(row), name: String(d.name), dailyCaloriesTarget: Number(d.daily_calories_target), dailyProteinTarget: d.daily_protein_target as number | null, dailyCarbsTarget: d.daily_carbs_target as number | null, dailyFatTarget: d.daily_fat_target as number | null, dailySugarTarget: d.daily_sugar_target as number | null, dailyFiberTarget: d.daily_fiber_target as number | null, dailySaltTarget: d.daily_salt_target as number | null });
		if (row.entity === "foods") foods.set(id(row.id), { ...common(row), nameDe: String(d.name_de), nameEn: String(d.name_en), brand: d.brand as string | null, ean: d.ean as string | null, caloriesPer100g: Number(d.calories_per_100g), fatPer100g: Number(d.fat_per_100g), carbsPer100g: Number(d.carbs_per_100g), sugarPer100g: Number(d.sugar_per_100g), fiberPer100g: Number(d.fiber_per_100g), proteinPer100g: Number(d.protein_per_100g), saltPer100g: Number(d.salt_per_100g), isCustom: Boolean(d.is_custom), portionSizeGrams: d.portion_size_grams as number | null | undefined ?? null });
		if (row.entity === "recipes") recipes.set(id(row.id), { ...common(row), nameDe: String(d.name_de), nameEn: String(d.name_en), description: d.description as string | null, isSubRecipe: Boolean(d.is_sub_recipe), portionSizeGrams: d.portion_size_grams as number | null | undefined ?? null, ingredients: (d.ingredients as Record<string, unknown>[]).map(child => ({ id: id(child.id), recipeId: id(row.id), foodId: ref(child.food_id), subRecipeId: ref(child.sub_recipe_id), amountGrams: Number(child.amount_grams), createdAt: String(child.created_at) })) });
	}
	const nutritionSource = { listRecipeIngredients: async (value: number): Promise<RecipeIngredient[]> => recipes.get(value)?.ingredients ?? [], getFoodById: async (value: number) => foods.get(value) ?? null };
	const nutrition = (value: number) => calculateRecipeNutrition(nutritionSource, value);
	async function meal(value: number): Promise<MealLog | null> {
		const row = roots.get(aliases.get(`meal_logs:${value}`) ?? ""); if (!row?.data) return null; const d = row.data, foodId = ref(d.food_id), recipeId = ref(d.recipe_id), totalWeightGrams = Number(d.total_weight_grams);
		return { ...common(row), loggedAt: String(d.logged_at), foodId, recipeId, totalWeightGrams, sourceName: foodId !== null ? foods.get(foodId)!.nameDe : recipes.get(recipeId!)!.nameDe, sourceType: foodId !== null ? "food" : "recipe", nutritionPer100g: foodId !== null ? foodNutrition(foods.get(foodId)!) : (await nutrition(recipeId!)).per100g,
			profiles: (d.profiles as Record<string, unknown>[]).map(child => ({ id: id(child.id), mealLogId: value, profileId: id(child.profile_id), profileName: profiles.get(id(child.profile_id))!.name, portionFactor: Number(child.portion_factor), portionGrams: Math.round(totalWeightGrams * Number(child.portion_factor) * 100) / 100 })).sort((a,b) => a.profileName.localeCompare(b.profileName)) };
	}
	function utcDate(text: string) { const iso = text.replace(" ", "T"), normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`; const date = new Date(normalized); return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0,10); }
	const read = {
		activities: { listActivities: async () => [...activities.values()].sort((a,b) => a.name.localeCompare(b.name)), getActivityById: async (value: number) => activities.get(value) ?? null },
		activityLogs: { listActivityLogs: async () => [...activityLogs.values()].sort((a,b) => b.date.localeCompare(a.date) || b.id-a.id) },
		profiles: { listProfiles: async () => [...profiles.values()].sort((a,b) => a.name.localeCompare(b.name)), getProfileById: async (value: number) => profiles.get(value) ?? null },
		foods: { listFoods: async (search = "") => [...foods.values()].filter(food => [food.nameDe, food.nameEn, food.brand ?? "", food.ean ?? ""].some(text => text.toLowerCase().includes(search.toLowerCase()))).sort((a,b) => a.nameDe.localeCompare(b.nameDe)), getFoodById: nutritionSource.getFoodById, getFoodByEan: async (ean: string) => [...foods.values()].find(food => food.ean === ean) ?? null, getFoodByNameDe: async (name: string) => [...foods.values()].find(food => food.nameDe.toLowerCase() === name.toLowerCase()) ?? null },
		recipes: { listRecipes: async () => [...recipes.values()].sort((a,b) => a.nameDe.localeCompare(b.nameDe)), getRecipeById: async (value: number) => recipes.get(value) ?? null, getRecipeWithIngredients: async (value: number) => recipes.get(value) ?? null, listRecipeIngredients: nutritionSource.listRecipeIngredients, calculateRecipeNutrition: nutrition, getRecipeIngredientById: async (value: number) => [...recipes.values()].flatMap(recipe => recipe.ingredients).find(child => child.id === value) ?? null },
		mealLogs: { getMealLogById: meal, listMealLogs: async (filter: MealLogFilter = {}) => (await Promise.all([...roots.values()].filter(row => row.entity === "meal_logs" && row.data).map(row => meal(id(row.id))))).filter((row): row is MealLog => row !== null && (filter.profileId === undefined || row.profiles.some(child => child.profileId === filter.profileId)) && (!filter.date || utcDate(row.loggedAt) === utcDate(filter.date))).sort((a,b) => b.loggedAt.localeCompare(a.loggedAt) || b.id-a.id) },
	};
	return { read, root, uuid, id, roots };
}
