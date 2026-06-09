import { getFoodById, type Food } from "./foods";
import {
	calculateRecipeNutrition,
	getRecipeById,
	type NutritionValues,
} from "./recipes";
import { lastInsertId, querySql, runSql } from "../sql";

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

export type MealLogProfileInput = {
	profileId: number;
	portionGrams: number;
};

export type CreateMealLogInput = {
	loggedAt?: string | null;
	foodId?: number | null;
	recipeId?: number | null;
	profiles: MealLogProfileInput[];
};

export type UpdateMealLogInput = CreateMealLogInput;

type MealLogRow = {
	id: number;
	logged_at: string;
	food_id: number | null;
	recipe_id: number | null;
	total_weight_grams: number;
	created_at: string;
	updated_at: string | null;
};

type MealLogProfileRow = {
	id: number;
	meal_log_id: number;
	profile_id: number;
	profile_name: string;
	portion_factor: number;
};

const emptyNutrition = (): NutritionValues => ({
	calories: 0,
	fat: 0,
	carbs: 0,
	sugar: 0,
	fiber: 0,
	protein: 0,
	salt: 0,
});

function foodNutrition(food: Food): NutritionValues {
	return {
		calories: food.caloriesPer100g,
		fat: food.fatPer100g,
		carbs: food.carbsPer100g,
		sugar: food.sugarPer100g,
		fiber: food.fiberPer100g,
		protein: food.proteinPer100g,
		salt: food.saltPer100g,
	};
}

function scaleNutrition(
	values: NutritionValues,
	grams: number,
): NutritionValues {
	const factor = grams / 100;
	return {
		calories: Math.round(values.calories * factor),
		fat: Math.round(values.fat * factor * 100) / 100,
		carbs: Math.round(values.carbs * factor * 100) / 100,
		sugar: Math.round(values.sugar * factor * 100) / 100,
		fiber: Math.round(values.fiber * factor * 100) / 100,
		protein: Math.round(values.protein * factor * 100) / 100,
		salt: Math.round(values.salt * factor * 100) / 100,
	};
}

export function calculateMealLogProfileNutrition(
	mealLog: MealLog,
	profileId: number,
) {
	const profile = mealLog.profiles.find((item) => item.profileId === profileId);
	return profile
		? scaleNutrition(mealLog.nutritionPer100g, profile.portionGrams)
		: emptyNutrition();
}

async function sourceForMealLog(
	row: MealLogRow,
): Promise<{
	name: string;
	type: "food" | "recipe";
	nutritionPer100g: NutritionValues;
}> {
	if (row.food_id) {
		const food = await getFoodById(row.food_id);
		return {
			name: food?.nameDe ?? "Unknown food",
			type: "food",
			nutritionPer100g: food ? foodNutrition(food) : emptyNutrition(),
		};
	}

	if (row.recipe_id) {
		const recipe = await getRecipeById(row.recipe_id);
		const nutrition = await calculateRecipeNutrition(row.recipe_id);
		return {
			name: recipe?.nameDe ?? "Unknown recipe",
			type: "recipe",
			nutritionPer100g: nutrition.per100g,
		};
	}

	return { name: "Unknown", type: "food", nutritionPer100g: emptyNutrition() };
}

async function listProfilesForMealLog(
	mealLogId: number,
	totalWeightGrams: number,
): Promise<MealLogProfile[]> {
	const rows = await querySql<MealLogProfileRow>(
		`
      SELECT mlp.*, profiles.name AS profile_name
      FROM meal_log_profiles mlp
      JOIN profiles ON profiles.id = mlp.profile_id
      WHERE mlp.meal_log_id = ?
      ORDER BY profiles.name COLLATE NOCASE ASC;
    `,
		[mealLogId],
	);

	return rows.map((row) => ({
		id: row.id,
		mealLogId: row.meal_log_id,
		profileId: row.profile_id,
		profileName: row.profile_name,
		portionFactor: row.portion_factor,
		portionGrams: Math.round(totalWeightGrams * row.portion_factor * 100) / 100,
	}));
}

async function mapMealLog(row: MealLogRow): Promise<MealLog> {
	const source = await sourceForMealLog(row);

	return {
		id: row.id,
		loggedAt: row.logged_at,
		foodId: row.food_id,
		recipeId: row.recipe_id,
		totalWeightGrams: row.total_weight_grams,
		sourceName: source.name,
		sourceType: source.type,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		profiles: await listProfilesForMealLog(row.id, row.total_weight_grams),
		nutritionPer100g: source.nutritionPer100g,
	};
}

export async function listMealLogs(
	options: { profileId?: number; date?: string } = {},
) {
	const where: string[] = [];
	const values: Array<string | number> = [];

	if (options.profileId) {
		where.push(
			"EXISTS (SELECT 1 FROM meal_log_profiles mlp WHERE mlp.meal_log_id = meal_logs.id AND mlp.profile_id = ?)",
		);
		values.push(options.profileId);
	}

	if (options.date) {
		where.push("date(logged_at) = date(?)");
		values.push(options.date);
	}

	const rows = await querySql<MealLogRow>(
		`
      SELECT *
      FROM meal_logs
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY logged_at DESC, id DESC;
    `,
		values,
	);

	return Promise.all(rows.map(mapMealLog));
}

export async function getMealLogById(id: number) {
	const rows = await querySql<MealLogRow>(
		"SELECT * FROM meal_logs WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapMealLog(rows[0]) : null;
}

function totalWeight(profiles: MealLogProfileInput[]) {
	return (
		Math.round(
			profiles.reduce(
				(sum, profile) => sum + Math.max(0, profile.portionGrams),
				0,
			) * 100,
		) / 100
	);
}

async function insertMealLogProfiles(
	mealLogId: number,
	totalWeightGrams: number,
	profiles: MealLogProfileInput[],
) {
	for (const profile of profiles.filter((item) => item.portionGrams > 0)) {
		await runSql(
			"INSERT INTO meal_log_profiles (meal_log_id, profile_id, portion_factor) VALUES (?, ?, ?);",
			[mealLogId, profile.profileId, profile.portionGrams / totalWeightGrams],
		);
	}
}

export async function createMealLog(input: CreateMealLogInput) {
	const totalWeightGrams = totalWeight(input.profiles);

	if (totalWeightGrams <= 0) {
		throw new Error("Meal log needs at least one positive profile portion.");
	}

	const result = await runSql(
		`
      INSERT INTO meal_logs (logged_at, food_id, recipe_id, total_weight_grams)
      VALUES (COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?);
    `,
		[
			input.loggedAt ?? null,
			input.foodId ?? null,
			input.recipeId ?? null,
			totalWeightGrams,
		],
	);
	const mealLogId = lastInsertId(result);
	await insertMealLogProfiles(mealLogId, totalWeightGrams, input.profiles);
	return getMealLogById(mealLogId);
}

export async function updateMealLog(id: number, input: UpdateMealLogInput) {
	const totalWeightGrams = totalWeight(input.profiles);

	if (totalWeightGrams <= 0) {
		throw new Error("Meal log needs at least one positive profile portion.");
	}

	await runSql(
		`
      UPDATE meal_logs
      SET logged_at = COALESCE(?, logged_at), food_id = ?, recipe_id = ?, total_weight_grams = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?;
    `,
		[
			input.loggedAt ?? null,
			input.foodId ?? null,
			input.recipeId ?? null,
			totalWeightGrams,
			id,
		],
	);
	await runSql("DELETE FROM meal_log_profiles WHERE meal_log_id = ?;", [id]);
	await insertMealLogProfiles(id, totalWeightGrams, input.profiles);
	return getMealLogById(id);
}

export async function deleteMealLog(id: number) {
	const result = await runSql("DELETE FROM meal_logs WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}
