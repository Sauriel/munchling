import { databaseSql } from "../sql";
import { fromSqlBoolean, lastInsertId, normalizeOptionalText, toSqlBoolean, type SqlDatabase, type SqlExecutor } from "../executor";
import type { Food, CreateFoodInput, UpdateFoodInput } from "../../../../shared/domain/types";
export type { Food, CreateFoodInput, UpdateFoodInput } from "../../../../shared/domain/types";

type FoodRow = {
	id: number;
	name_de: string;
	name_en: string;
	brand: string | null;
	ean: string | null;
	calories_per_100g: number;
	fat_per_100g: number;
	carbs_per_100g: number;
	sugar_per_100g: number;
	fiber_per_100g: number;
	protein_per_100g: number;
	salt_per_100g: number;
	is_custom: number;
	created_at: string;
	updated_at: string | null;
};

function mapFood(row: FoodRow): Food {
	return {
		id: row.id,
		nameDe: row.name_de,
		nameEn: row.name_en,
		brand: row.brand,
		ean: row.ean,
		caloriesPer100g: row.calories_per_100g,
		fatPer100g: row.fat_per_100g,
		carbsPer100g: row.carbs_per_100g,
		sugarPer100g: row.sugar_per_100g,
		fiberPer100g: row.fiber_per_100g,
		proteinPer100g: row.protein_per_100g,
		saltPer100g: row.salt_per_100g,
		isCustom: fromSqlBoolean(row.is_custom),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function createFoodsRepository(database: SqlDatabase) {
async function listFoods(searchTerm?: string) {
	if (!searchTerm?.trim()) {
		const rows = await database.query<FoodRow>(`
      SELECT *
      FROM foods
      ORDER BY name_de COLLATE NOCASE ASC, id ASC;
    `);
		return rows.map(mapFood);
	}

	const search = `%${searchTerm.trim()}%`;
	const rows = await database.query<FoodRow>(
		`
      SELECT *
      FROM foods
      WHERE name_de LIKE ? OR name_en LIKE ? OR brand LIKE ? OR ean LIKE ?
      ORDER BY name_de COLLATE NOCASE ASC, id ASC;
    `,
		[search, search, search, search],
	);

	return rows.map(mapFood);
}

async function getFoodById(id: number, sql: SqlExecutor = database) {
	const rows = await sql.query<FoodRow>(
		"SELECT * FROM foods WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapFood(rows[0]) : null;
}

async function getFoodByEan(ean: string) {
	const normalizedEan = normalizeOptionalText(ean);

	if (!normalizedEan) {
		return null;
	}

	const rows = await database.query<FoodRow>(
		"SELECT * FROM foods WHERE ean = ? LIMIT 1;",
		[normalizedEan],
	);
	return rows[0] ? mapFood(rows[0]) : null;
}

async function getFoodByNameDe(nameDe: string) {
	const normalizedName = nameDe.trim().toLocaleLowerCase();

	if (!normalizedName) {
		return null;
	}

	const rows = await database.query<FoodRow>(
		"SELECT * FROM foods WHERE lower(trim(name_de)) = ? LIMIT 1;",
		[normalizedName],
	);
	return rows[0] ? mapFood(rows[0]) : null;
}

async function createFood(input: CreateFoodInput) {
	const result = await database.run(
		`
      INSERT INTO foods (
        name_de,
        name_en,
        brand,
        ean,
        calories_per_100g,
        fat_per_100g,
        carbs_per_100g,
        sugar_per_100g,
        fiber_per_100g,
        protein_per_100g,
        salt_per_100g,
        is_custom
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `,
		[
			input.nameDe.trim(),
			input.nameEn.trim(),
			normalizeOptionalText(input.brand),
			normalizeOptionalText(input.ean),
			input.caloriesPer100g,
			input.fatPer100g,
			input.carbsPer100g,
			input.sugarPer100g,
			input.fiberPer100g,
			input.proteinPer100g,
			input.saltPer100g,
			toSqlBoolean(input.isCustom ?? true),
		],
	);

	return getFoodById(lastInsertId(result));
}

async function updateFood(id: number, input: UpdateFoodInput) {
	if (!Object.values(input).some((value) => value !== undefined)) return getFoodById(id);
	await database.run(
		`UPDATE foods SET
		 name_de = CASE WHEN ? THEN ? ELSE name_de END,
		 name_en = CASE WHEN ? THEN ? ELSE name_en END,
		 brand = CASE WHEN ? THEN ? ELSE brand END,
		 ean = CASE WHEN ? THEN ? ELSE ean END,
		 calories_per_100g = CASE WHEN ? THEN ? ELSE calories_per_100g END,
		 fat_per_100g = CASE WHEN ? THEN ? ELSE fat_per_100g END,
		 carbs_per_100g = CASE WHEN ? THEN ? ELSE carbs_per_100g END,
		 sugar_per_100g = CASE WHEN ? THEN ? ELSE sugar_per_100g END,
		 fiber_per_100g = CASE WHEN ? THEN ? ELSE fiber_per_100g END,
		 protein_per_100g = CASE WHEN ? THEN ? ELSE protein_per_100g END,
		 salt_per_100g = CASE WHEN ? THEN ? ELSE salt_per_100g END,
		 is_custom = CASE WHEN ? THEN ? ELSE is_custom END,
		 updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
		[
			input.nameDe !== undefined, input.nameDe?.trim() ?? null,
			input.nameEn !== undefined, input.nameEn?.trim() ?? null,
			input.brand !== undefined, normalizeOptionalText(input.brand),
			input.ean !== undefined, normalizeOptionalText(input.ean),
			input.caloriesPer100g !== undefined, input.caloriesPer100g ?? null,
			input.fatPer100g !== undefined, input.fatPer100g ?? null,
			input.carbsPer100g !== undefined, input.carbsPer100g ?? null,
			input.sugarPer100g !== undefined, input.sugarPer100g ?? null,
			input.fiberPer100g !== undefined, input.fiberPer100g ?? null,
			input.proteinPer100g !== undefined, input.proteinPer100g ?? null,
			input.saltPer100g !== undefined, input.saltPer100g ?? null,
			input.isCustom !== undefined, toSqlBoolean(input.isCustom ?? false), id,
		],
	);
	return getFoodById(id);
}

async function deleteFood(id: number) {
	const result = await database.run("DELETE FROM foods WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}
return { listFoods, getFoodById, getFoodByEan, getFoodByNameDe, createFood, updateFood, deleteFood };
}

export const { listFoods, getFoodById, getFoodByEan, getFoodByNameDe, createFood, updateFood, deleteFood } = createFoodsRepository(databaseSql);
