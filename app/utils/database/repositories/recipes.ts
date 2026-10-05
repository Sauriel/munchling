import type {
	Recipe, RecipeIngredient, RecipeWithIngredients, RecipeIngredientInput,
	CreateRecipeInput, UpdateRecipeInput, RecipeNutrition,
} from "../../../../shared/domain/types";
import { calculateRecipeNutrition as calculateNutrition } from "../../../../shared/domain/nutrition";
import { createFoodsRepository } from "./foods";
import { databaseSql } from "../sql";
import {
	fromSqlBoolean, lastInsertId, normalizeOptionalText, toSqlBoolean,
	type SqlDatabase, type SqlExecutor,
} from "../executor";

export type {
	Recipe, RecipeIngredient, RecipeWithIngredients, RecipeIngredientInput,
	CreateRecipeInput, UpdateRecipeInput, RecipeNutrition, NutritionValues,
} from "../../../../shared/domain/types";

type RecipeRow = {
	id: number; name_de: string; name_en: string; description: string | null;
	is_sub_recipe: number; created_at: string; updated_at: string | null;
};
type RecipeIngredientRow = {
	id: number; recipe_id: number; food_id: number | null;
	sub_recipe_id: number | null; amount_grams: number; created_at: string;
};

function mapRecipe(row: RecipeRow): Recipe {
	return {
		id: row.id, nameDe: row.name_de, nameEn: row.name_en,
		description: row.description, isSubRecipe: fromSqlBoolean(row.is_sub_recipe),
		createdAt: row.created_at, updatedAt: row.updated_at,
	};
}
function mapIngredient(row: RecipeIngredientRow): RecipeIngredient {
	return {
		id: row.id, recipeId: row.recipe_id, foodId: row.food_id,
		subRecipeId: row.sub_recipe_id, amountGrams: row.amount_grams, createdAt: row.created_at,
	};
}

export function createRecipesRepository(database: SqlDatabase) {
	const foods = createFoodsRepository(database);

	async function listRecipes() {
		const rows = await database.query<RecipeRow>(
			"SELECT * FROM recipes ORDER BY name_de COLLATE NOCASE ASC, id ASC;",
		);
		return rows.map(mapRecipe);
	}
	async function getRecipeById(id: number, sql: SqlExecutor = database) {
		const rows = await sql.query<RecipeRow>("SELECT * FROM recipes WHERE id = ? LIMIT 1;", [id]);
		return rows[0] ? mapRecipe(rows[0]) : null;
	}
	async function listRecipeIngredients(recipeId: number, sql: SqlExecutor = database) {
		const rows = await sql.query<RecipeIngredientRow>(
			"SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY id ASC;", [recipeId],
		);
		return rows.map(mapIngredient);
	}
	async function getRecipeWithIngredients(id: number, sql: SqlExecutor = database): Promise<RecipeWithIngredients | null> {
		const recipe = await getRecipeById(id, sql);
		return recipe ? { ...recipe, ingredients: await listRecipeIngredients(id, sql) } : null;
	}
	async function getRecipeIngredientById(id: number, sql: SqlExecutor = database) {
		const rows = await sql.query<RecipeIngredientRow>(
			"SELECT * FROM recipe_ingredients WHERE id = ? LIMIT 1;", [id],
		);
		return rows[0] ? mapIngredient(rows[0]) : null;
	}
	async function insertIngredient(sql: SqlExecutor, recipeId: number, input: RecipeIngredientInput) {
		const result = await sql.run(
			"INSERT INTO recipe_ingredients (recipe_id, food_id, sub_recipe_id, amount_grams) VALUES (?, ?, ?, ?);",
			[recipeId, input.foodId ?? null, input.subRecipeId ?? null, input.amountGrams],
		);
		return getRecipeIngredientById(lastInsertId(result), sql);
	}
	async function replaceIngredients(sql: SqlExecutor, recipeId: number, ingredients: RecipeIngredientInput[]) {
		await sql.run("DELETE FROM recipe_ingredients WHERE recipe_id = ?;", [recipeId]);
		for (const ingredient of ingredients) await insertIngredient(sql, recipeId, ingredient);
	}

	async function createRecipe(input: CreateRecipeInput) {
		return database.transaction(async (sql) => {
			const result = await sql.run(
				"INSERT INTO recipes (name_de, name_en, description, is_sub_recipe) VALUES (?, ?, ?, ?);",
				[input.nameDe.trim(), input.nameEn.trim(), normalizeOptionalText(input.description), toSqlBoolean(input.isSubRecipe ?? false)],
			);
			const recipeId = lastInsertId(result);
			for (const ingredient of input.ingredients ?? []) await insertIngredient(sql, recipeId, ingredient);
			return getRecipeWithIngredients(recipeId, sql);
		});
	}
	async function updateRecipe(id: number, input: UpdateRecipeInput) {
		return database.transaction(async (sql) => {
			if (input.nameDe !== undefined || input.nameEn !== undefined || input.description !== undefined || input.isSubRecipe !== undefined || input.ingredients !== undefined) {
				await sql.run(
					`UPDATE recipes SET
					 name_de = CASE WHEN ? THEN ? ELSE name_de END,
					 name_en = CASE WHEN ? THEN ? ELSE name_en END,
					 description = CASE WHEN ? THEN ? ELSE description END,
					 is_sub_recipe = CASE WHEN ? THEN ? ELSE is_sub_recipe END,
					 updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
					[
						input.nameDe !== undefined, input.nameDe?.trim() ?? null,
						input.nameEn !== undefined, input.nameEn?.trim() ?? null,
						input.description !== undefined, normalizeOptionalText(input.description),
						input.isSubRecipe !== undefined, toSqlBoolean(input.isSubRecipe ?? false), id,
					],
				);
			}
			if (input.ingredients !== undefined) await replaceIngredients(sql, id, input.ingredients);
			return getRecipeWithIngredients(id, sql);
		});
	}
	async function deleteRecipe(id: number) {
		const result = await database.run("DELETE FROM recipes WHERE id = ?;", [id]);
		return result.changes?.changes ?? 0;
	}
	async function addRecipeIngredient(recipeId: number, input: RecipeIngredientInput) {
		return database.transaction(async (sql) => {
			const ingredient = await insertIngredient(sql, recipeId, input);
			await sql.run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [recipeId]);
			return ingredient;
		});
	}
	async function updateRecipeIngredient(id: number, input: RecipeIngredientInput) {
		return database.transaction(async (sql) => {
			await sql.run(
				"UPDATE recipe_ingredients SET food_id = ?, sub_recipe_id = ?, amount_grams = ? WHERE id = ?;",
				[input.foodId ?? null, input.subRecipeId ?? null, input.amountGrams, id],
			);
			const ingredient = await getRecipeIngredientById(id, sql);
			if (ingredient) await sql.run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [ingredient.recipeId]);
			return ingredient;
		});
	}
	async function deleteRecipeIngredient(id: number) {
		return database.transaction(async (sql) => {
			const ingredient = await getRecipeIngredientById(id, sql);
			const result = await sql.run("DELETE FROM recipe_ingredients WHERE id = ?;", [id]);
			if (ingredient) await sql.run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [ingredient.recipeId]);
			return result.changes?.changes ?? 0;
		});
	}
	async function replaceRecipeIngredients(recipeId: number, ingredients: RecipeIngredientInput[]) {
		return database.transaction(async (sql) => {
			await replaceIngredients(sql, recipeId, ingredients);
			await sql.run("UPDATE recipes SET updated_at = CURRENT_TIMESTAMP WHERE id = ?;", [recipeId]);
			return listRecipeIngredients(recipeId, sql);
		});
	}
	async function calculateRecipeNutrition(recipeId: number, visitedRecipeIds = new Set<number>(), sql: SqlExecutor = database): Promise<RecipeNutrition> {
		return calculateNutrition({
			listRecipeIngredients: (id) => listRecipeIngredients(id, sql),
			getFoodById: (id) => foods.getFoodById(id, sql),
		}, recipeId, visitedRecipeIds);
	}

	return {
		listRecipes, getRecipeById, listRecipeIngredients, getRecipeWithIngredients,
		createRecipe, updateRecipe, deleteRecipe, addRecipeIngredient,
		getRecipeIngredientById, updateRecipeIngredient, deleteRecipeIngredient,
		replaceRecipeIngredients, calculateRecipeNutrition,
	};
}

export const {
	listRecipes, getRecipeById, listRecipeIngredients, getRecipeWithIngredients,
	createRecipe, updateRecipe, deleteRecipe, addRecipeIngredient,
	getRecipeIngredientById, updateRecipeIngredient, deleteRecipeIngredient,
	replaceRecipeIngredients, calculateRecipeNutrition,
} = createRecipesRepository(databaseSql);
