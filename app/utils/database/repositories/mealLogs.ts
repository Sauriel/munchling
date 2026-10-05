import type {
	MealLog, MealLogProfile, MealLogProfileInput, CreateMealLogInput,
	UpdateMealLogInput, MealLogFilter, NutritionValues,
} from "../../../../shared/domain/types";
import { emptyNutrition, foodNutrition } from "../../../../shared/domain/nutrition";
import { createFoodsRepository } from "./foods";
import { assertId, validateMealInput, validateMealReferences } from "../../../../shared/domain/validation";
import { createReferenceLookup } from "../validation";
import { createRecipesRepository } from "./recipes";
import { databaseSql } from "../sql";
import { lastInsertId, type SqlDatabase, type SqlExecutor, type SqlValue } from "../executor";

export type { MealLog, MealLogProfile, MealLogProfileInput, CreateMealLogInput, UpdateMealLogInput } from "../../../../shared/domain/types";
export { calculateMealLogProfileNutrition } from "../../../../shared/domain/nutrition";

type MealLogRow = {
	id: number; logged_at: string; food_id: number | null; recipe_id: number | null;
	total_weight_grams: number; created_at: string; updated_at: string | null;
};
type MealLogProfileRow = {
	id: number; meal_log_id: number; profile_id: number; profile_name: string; portion_factor: number;
};

function totalWeight(profiles: MealLogProfileInput[]) {
	return Math.round(profiles.reduce((sum, profile) => sum + Math.max(0, profile.portionGrams), 0) * 100) / 100;
}

export function createMealLogsRepository(database: SqlDatabase) {
	const foods = createFoodsRepository(database);
	const recipes = createRecipesRepository(database);

	async function sourceForMealLog(row: MealLogRow, sql: SqlExecutor): Promise<{
		name: string; type: "food" | "recipe"; nutritionPer100g: NutritionValues;
	}> {
		if (row.food_id !== null) {
			const food = await foods.getFoodById(row.food_id, sql);
			return { name: food?.nameDe ?? "Unknown food", type: "food", nutritionPer100g: food ? foodNutrition(food) : emptyNutrition() };
		}
		if (row.recipe_id !== null) {
			const recipe = await recipes.getRecipeById(row.recipe_id, sql);
			const nutrition = await recipes.calculateRecipeNutrition(row.recipe_id, new Set(), sql);
			return { name: recipe?.nameDe ?? "Unknown recipe", type: "recipe", nutritionPer100g: nutrition.per100g };
		}
		return { name: "Unknown", type: "food", nutritionPer100g: emptyNutrition() };
	}
	async function listProfilesForMealLog(mealLogId: number, totalWeightGrams: number, sql: SqlExecutor): Promise<MealLogProfile[]> {
		const rows = await sql.query<MealLogProfileRow>(
			`SELECT mlp.*, profiles.name AS profile_name FROM meal_log_profiles mlp
			 JOIN profiles ON profiles.id = mlp.profile_id
			 WHERE mlp.meal_log_id = ? ORDER BY profiles.name COLLATE NOCASE ASC;`, [mealLogId],
		);
		return rows.map((row) => ({
			id: row.id, mealLogId: row.meal_log_id, profileId: row.profile_id,
			profileName: row.profile_name, portionFactor: row.portion_factor,
			portionGrams: Math.round(totalWeightGrams * row.portion_factor * 100) / 100,
		}));
	}
	async function mapMealLog(row: MealLogRow, sql: SqlExecutor): Promise<MealLog> {
		const source = await sourceForMealLog(row, sql);
		return {
			id: row.id, loggedAt: row.logged_at, foodId: row.food_id, recipeId: row.recipe_id,
			totalWeightGrams: row.total_weight_grams, sourceName: source.name, sourceType: source.type,
			createdAt: row.created_at, updatedAt: row.updated_at,
			profiles: await listProfilesForMealLog(row.id, row.total_weight_grams, sql),
			nutritionPer100g: source.nutritionPer100g,
		};
	}
	async function listMealLogs(options: MealLogFilter = {}) {
		// Fixed predicates: all filter values remain parameterized.
		const rows = await database.query<MealLogRow>(
			`SELECT * FROM meal_logs
			 WHERE (? IS NULL OR EXISTS (SELECT 1 FROM meal_log_profiles mlp WHERE mlp.meal_log_id = meal_logs.id AND mlp.profile_id = ?))
			 AND (? IS NULL OR date(logged_at) = date(?)) ORDER BY logged_at DESC, id DESC;`,
			[options.profileId ?? null, options.profileId ?? null, options.date ?? null, options.date ?? null],
		);
		return Promise.all(rows.map((row) => mapMealLog(row, database)));
	}
	async function getMealLogById(id: number, sql: SqlExecutor = database) {
		const rows = await sql.query<MealLogRow>("SELECT * FROM meal_logs WHERE id = ? LIMIT 1;", [id]);
		return rows[0] ? mapMealLog(rows[0], sql) : null;
	}
	async function insertMealLogProfiles(sql: SqlExecutor, mealLogId: number, totalWeightGrams: number, profiles: MealLogProfileInput[]) {
		for (const profile of profiles.filter((item) => item.portionGrams > 0)) {
			await sql.run(
				"INSERT INTO meal_log_profiles (meal_log_id, profile_id, portion_factor) VALUES (?, ?, ?);",
				[mealLogId, profile.profileId, profile.portionGrams / totalWeightGrams],
			);
		}
	}
	function mealValues(input: CreateMealLogInput, totalWeightGrams: number): SqlValue[] {
		return [input.loggedAt ?? null, input.foodId ?? null, input.recipeId ?? null, totalWeightGrams];
	}
	async function createMealLog(input: CreateMealLogInput) {
		validateMealInput(input);
		const totalWeightGrams = totalWeight(input.profiles);
		if (!Number.isFinite(totalWeightGrams) || totalWeightGrams <= 0) {
			throw new Error("Meal log needs at least one positive profile portion.");
		}
		return database.transaction(async (sql) => {
			await validateMealReferences(input, createReferenceLookup(sql));
			const result = await sql.run(
				"INSERT INTO meal_logs (logged_at, food_id, recipe_id, total_weight_grams) VALUES (COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?);",
				mealValues(input, totalWeightGrams),
			);
			const mealLogId = lastInsertId(result);
			await insertMealLogProfiles(sql, mealLogId, totalWeightGrams, input.profiles);
			return getMealLogById(mealLogId, sql);
		});
	}
	async function updateMealLog(id: number, input: UpdateMealLogInput) {
		assertId(id);
		validateMealInput(input);
		const totalWeightGrams = totalWeight(input.profiles);
		if (!Number.isFinite(totalWeightGrams) || totalWeightGrams <= 0) {
			throw new Error("Meal log needs at least one positive profile portion.");
		}
		return database.transaction(async (sql) => {
			if (!await getMealLogById(id, sql)) return null;
			await validateMealReferences(input, createReferenceLookup(sql));
			await sql.run(
				`UPDATE meal_logs SET logged_at = COALESCE(?, logged_at), food_id = ?, recipe_id = ?,
				 total_weight_grams = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
				[...mealValues(input, totalWeightGrams), id],
			);
			await sql.run("DELETE FROM meal_log_profiles WHERE meal_log_id = ?;", [id]);
			await insertMealLogProfiles(sql, id, totalWeightGrams, input.profiles);
			return getMealLogById(id, sql);
		});
	}
	async function deleteMealLog(id: number) {
		assertId(id);
		const result = await database.run("DELETE FROM meal_logs WHERE id = ?;", [id]);
		return result.changes?.changes ?? 0;
	}
	return { listMealLogs, getMealLogById, createMealLog, updateMealLog, deleteMealLog };
}

export const { listMealLogs, getMealLogById, createMealLog, updateMealLog, deleteMealLog } = createMealLogsRepository(databaseSql);
