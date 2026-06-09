import type { Food } from "./foods";
import { getFoodById } from "./foods";
import {
	fromSqlBoolean,
	lastInsertId,
	querySql,
	runSql,
	toSqlBoolean,
} from "../sql";

export type Recipe = {
	id: number;
	nameDe: string;
	nameEn: string;
	description: string | null;
	isSubRecipe: boolean;
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

export type RecipeWithIngredients = Recipe & {
	ingredients: RecipeIngredient[];
};

type RecipeRow = {
	id: number;
	name_de: string;
	name_en: string;
	description: string | null;
	is_sub_recipe: number;
	created_at: string;
	updated_at: string | null;
};

type RecipeIngredientRow = {
	id: number;
	recipe_id: number;
	food_id: number | null;
	sub_recipe_id: number | null;
	amount_grams: number;
	created_at: string;
};

export type RecipeIngredientInput =
	| { foodId: number; subRecipeId?: never; amountGrams: number }
	| { foodId?: never; subRecipeId: number; amountGrams: number };

export type CreateRecipeInput = {
	nameDe: string;
	nameEn: string;
	description?: string | null;
	isSubRecipe?: boolean;
	ingredients?: RecipeIngredientInput[];
};

export type UpdateRecipeInput = Partial<
	Omit<CreateRecipeInput, "ingredients">
> & {
	ingredients?: RecipeIngredientInput[];
};

function optionalText(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function mapRecipe(row: RecipeRow): Recipe {
	return {
		id: row.id,
		nameDe: row.name_de,
		nameEn: row.name_en,
		description: row.description,
		isSubRecipe: fromSqlBoolean(row.is_sub_recipe),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapRecipeIngredient(row: RecipeIngredientRow): RecipeIngredient {
	return {
		id: row.id,
		recipeId: row.recipe_id,
		foodId: row.food_id,
		subRecipeId: row.sub_recipe_id,
		amountGrams: row.amount_grams,
		createdAt: row.created_at,
	};
}

export async function listRecipes() {
	const rows = await querySql<RecipeRow>(`
    SELECT *
    FROM recipes
    ORDER BY name_de COLLATE NOCASE ASC, id ASC;
  `);

	return rows.map(mapRecipe);
}

export async function getRecipeById(id: number) {
	const rows = await querySql<RecipeRow>(
		"SELECT * FROM recipes WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapRecipe(rows[0]) : null;
}

export async function listRecipeIngredients(recipeId: number) {
	const rows = await querySql<RecipeIngredientRow>(
		`
      SELECT *
      FROM recipe_ingredients
      WHERE recipe_id = ?
      ORDER BY id ASC;
    `,
		[recipeId],
	);

	return rows.map(mapRecipeIngredient);
}

export async function getRecipeWithIngredients(
	id: number,
): Promise<RecipeWithIngredients | null> {
	const recipe = await getRecipeById(id);

	if (!recipe) {
		return null;
	}

	return {
		...recipe,
		ingredients: await listRecipeIngredients(id),
	};
}

export async function createRecipe(input: CreateRecipeInput) {
	const result = await runSql(
		`
      INSERT INTO recipes (name_de, name_en, description, is_sub_recipe)
      VALUES (?, ?, ?, ?);
    `,
		[
			input.nameDe.trim(),
			input.nameEn.trim(),
			optionalText(input.description),
			toSqlBoolean(input.isSubRecipe ?? false),
		],
	);
	const recipeId = lastInsertId(result);

	for (const ingredient of input.ingredients ?? []) {
		await addRecipeIngredient(recipeId, ingredient);
	}

	return getRecipeWithIngredients(recipeId);
}

export async function updateRecipe(id: number, input: UpdateRecipeInput) {
	const assignments: string[] = [];
	const values: Array<string | number | null> = [];

	const add = (column: string, value: string | number | null) => {
		assignments.push(`${column} = ?`);
		values.push(value);
	};

	if (input.nameDe !== undefined) add("name_de", input.nameDe.trim());
	if (input.nameEn !== undefined) add("name_en", input.nameEn.trim());
	if (input.description !== undefined)
		add("description", optionalText(input.description));
	if (input.isSubRecipe !== undefined)
		add("is_sub_recipe", toSqlBoolean(input.isSubRecipe));

	if (assignments.length > 0) {
		assignments.push("updated_at = CURRENT_TIMESTAMP");
		values.push(id);
		await runSql(
			`UPDATE recipes SET ${assignments.join(", ")} WHERE id = ?;`,
			values,
		);
	}

	if (input.ingredients !== undefined) {
		await replaceRecipeIngredients(id, input.ingredients);
	}

	return getRecipeWithIngredients(id);
}

export async function deleteRecipe(id: number) {
	const result = await runSql("DELETE FROM recipes WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}

export async function addRecipeIngredient(
	recipeId: number,
	input: RecipeIngredientInput,
) {
	const result = await runSql(
		`
      INSERT INTO recipe_ingredients (recipe_id, food_id, sub_recipe_id, amount_grams)
      VALUES (?, ?, ?, ?);
    `,
		[
			recipeId,
			input.foodId ?? null,
			input.subRecipeId ?? null,
			input.amountGrams,
		],
	);

	return getRecipeIngredientById(lastInsertId(result));
}

export async function getRecipeIngredientById(id: number) {
	const rows = await querySql<RecipeIngredientRow>(
		"SELECT * FROM recipe_ingredients WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapRecipeIngredient(rows[0]) : null;
}

export async function updateRecipeIngredient(
	id: number,
	input: RecipeIngredientInput,
) {
	await runSql(
		`
      UPDATE recipe_ingredients
      SET food_id = ?, sub_recipe_id = ?, amount_grams = ?
      WHERE id = ?;
    `,
		[input.foodId ?? null, input.subRecipeId ?? null, input.amountGrams, id],
	);

	return getRecipeIngredientById(id);
}

export async function deleteRecipeIngredient(id: number) {
	const result = await runSql("DELETE FROM recipe_ingredients WHERE id = ?;", [
		id,
	]);
	return result.changes?.changes ?? 0;
}

export async function replaceRecipeIngredients(
	recipeId: number,
	ingredients: RecipeIngredientInput[],
) {
	await runSql("DELETE FROM recipe_ingredients WHERE recipe_id = ?;", [
		recipeId,
	]);

	for (const ingredient of ingredients) {
		await addRecipeIngredient(recipeId, ingredient);
	}

	return listRecipeIngredients(recipeId);
}

function emptyNutritionValues(): NutritionValues {
	return {
		calories: 0,
		fat: 0,
		carbs: 0,
		sugar: 0,
		fiber: 0,
		protein: 0,
		salt: 0,
	};
}

function addScaledFoodNutrition(
	total: NutritionValues,
	food: Food,
	amountGrams: number,
) {
	const factor = amountGrams / 100;
	total.calories += food.caloriesPer100g * factor;
	total.fat += food.fatPer100g * factor;
	total.carbs += food.carbsPer100g * factor;
	total.sugar += food.sugarPer100g * factor;
	total.fiber += food.fiberPer100g * factor;
	total.protein += food.proteinPer100g * factor;
	total.salt += food.saltPer100g * factor;
}

function addScaledRecipeNutrition(
	total: NutritionValues,
	nutrition: RecipeNutrition,
	amountGrams: number,
) {
	const factor = amountGrams / 100;
	total.calories += nutrition.per100g.calories * factor;
	total.fat += nutrition.per100g.fat * factor;
	total.carbs += nutrition.per100g.carbs * factor;
	total.sugar += nutrition.per100g.sugar * factor;
	total.fiber += nutrition.per100g.fiber * factor;
	total.protein += nutrition.per100g.protein * factor;
	total.salt += nutrition.per100g.salt * factor;
}

function roundNutrition(values: NutritionValues): NutritionValues {
	return {
		calories: Math.round(values.calories),
		fat: Math.round(values.fat * 100) / 100,
		carbs: Math.round(values.carbs * 100) / 100,
		sugar: Math.round(values.sugar * 100) / 100,
		fiber: Math.round(values.fiber * 100) / 100,
		protein: Math.round(values.protein * 100) / 100,
		salt: Math.round(values.salt * 100) / 100,
	};
}

export async function calculateRecipeNutrition(
	recipeId: number,
	visitedRecipeIds = new Set<number>(),
): Promise<RecipeNutrition> {
	if (visitedRecipeIds.has(recipeId)) {
		throw new Error(
			`Circular recipe reference detected for recipe ${recipeId}.`,
		);
	}

	visitedRecipeIds.add(recipeId);

	const ingredients = await listRecipeIngredients(recipeId);
	const total = emptyNutritionValues();
	let totalWeightGrams = 0;

	for (const ingredient of ingredients) {
		totalWeightGrams += ingredient.amountGrams;

		if (ingredient.foodId) {
			const food = await getFoodById(ingredient.foodId);

			if (food) {
				addScaledFoodNutrition(total, food, ingredient.amountGrams);
			}
			continue;
		}

		if (ingredient.subRecipeId) {
			const subRecipeNutrition = await calculateRecipeNutrition(
				ingredient.subRecipeId,
				new Set(visitedRecipeIds),
			);
			addScaledRecipeNutrition(
				total,
				subRecipeNutrition,
				ingredient.amountGrams,
			);
		}
	}

	const per100g = emptyNutritionValues();

	if (totalWeightGrams > 0) {
		const factor = 100 / totalWeightGrams;
		per100g.calories = total.calories * factor;
		per100g.fat = total.fat * factor;
		per100g.carbs = total.carbs * factor;
		per100g.sugar = total.sugar * factor;
		per100g.fiber = total.fiber * factor;
		per100g.protein = total.protein * factor;
		per100g.salt = total.salt * factor;
	}

	return {
		totalWeightGrams: Math.round(totalWeightGrams * 100) / 100,
		total: roundNutrition(total),
		per100g: roundNutrition(per100g),
	};
}
