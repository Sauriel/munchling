import { validateRecipeGraph, type ReferenceLookup } from "../../../shared/domain/validation";
import type { SqlExecutor } from "./executor";

export function createReferenceLookup(sql: SqlExecutor): ReferenceLookup {
	return {
		hasFood: async (id) => (await sql.query("SELECT id FROM foods WHERE id = ?;", [id])).length > 0,
		hasRecipe: async (id) => (await sql.query("SELECT id FROM recipes WHERE id = ?;", [id])).length > 0,
		hasProfile: async (id) => (await sql.query("SELECT id FROM profiles WHERE id = ?;", [id])).length > 0,
	};
}

export async function validateStoredRecipeGraph(sql: SqlExecutor) {
	const rows = await sql.query<{ recipe_id: number; sub_recipe_id: number | null }>(
		"SELECT recipe_id, sub_recipe_id FROM recipe_ingredients WHERE sub_recipe_id IS NOT NULL;",
	);
	validateRecipeGraph(rows.map((row) => ({ recipeId: row.recipe_id, subRecipeId: row.sub_recipe_id })));
}
