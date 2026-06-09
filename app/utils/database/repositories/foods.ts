import {
	fromSqlBoolean,
	lastInsertId,
	normalizeOptionalText,
	querySql,
	runSql,
	toSqlBoolean,
} from "../sql";

export type Food = {
	id: number;
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
	createdAt: string;
	updatedAt: string | null;
};

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

export type CreateFoodInput = {
	nameDe: string;
	nameEn: string;
	brand?: string | null;
	ean?: string | null;
	caloriesPer100g: number;
	fatPer100g: number;
	carbsPer100g: number;
	sugarPer100g: number;
	fiberPer100g: number;
	proteinPer100g: number;
	saltPer100g: number;
	isCustom?: boolean;
};

export type UpdateFoodInput = Partial<CreateFoodInput>;

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

export async function listFoods(searchTerm?: string) {
	if (!searchTerm?.trim()) {
		const rows = await querySql<FoodRow>(`
      SELECT *
      FROM foods
      ORDER BY name_de COLLATE NOCASE ASC, id ASC;
    `);
		return rows.map(mapFood);
	}

	const search = `%${searchTerm.trim()}%`;
	const rows = await querySql<FoodRow>(
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

export async function getFoodById(id: number) {
	const rows = await querySql<FoodRow>(
		"SELECT * FROM foods WHERE id = ? LIMIT 1;",
		[id],
	);
	return rows[0] ? mapFood(rows[0]) : null;
}

export async function getFoodByEan(ean: string) {
	const normalizedEan = normalizeOptionalText(ean);

	if (!normalizedEan) {
		return null;
	}

	const rows = await querySql<FoodRow>(
		"SELECT * FROM foods WHERE ean = ? LIMIT 1;",
		[normalizedEan],
	);
	return rows[0] ? mapFood(rows[0]) : null;
}

export async function createFood(input: CreateFoodInput) {
	const result = await runSql(
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

export async function updateFood(id: number, input: UpdateFoodInput) {
	const assignments: string[] = [];
	const values: Array<string | number | null> = [];

	const add = (column: string, value: string | number | null) => {
		assignments.push(`${column} = ?`);
		values.push(value);
	};

	if (input.nameDe !== undefined) add("name_de", input.nameDe.trim());
	if (input.nameEn !== undefined) add("name_en", input.nameEn.trim());
	if (input.brand !== undefined)
		add("brand", normalizeOptionalText(input.brand));
	if (input.ean !== undefined) add("ean", normalizeOptionalText(input.ean));
	if (input.caloriesPer100g !== undefined)
		add("calories_per_100g", input.caloriesPer100g);
	if (input.fatPer100g !== undefined) add("fat_per_100g", input.fatPer100g);
	if (input.carbsPer100g !== undefined)
		add("carbs_per_100g", input.carbsPer100g);
	if (input.sugarPer100g !== undefined)
		add("sugar_per_100g", input.sugarPer100g);
	if (input.fiberPer100g !== undefined)
		add("fiber_per_100g", input.fiberPer100g);
	if (input.proteinPer100g !== undefined)
		add("protein_per_100g", input.proteinPer100g);
	if (input.saltPer100g !== undefined) add("salt_per_100g", input.saltPer100g);
	if (input.isCustom !== undefined)
		add("is_custom", toSqlBoolean(input.isCustom));

	if (assignments.length === 0) {
		return getFoodById(id);
	}

	assignments.push("updated_at = CURRENT_TIMESTAMP");
	values.push(id);

	await runSql(
		`UPDATE foods SET ${assignments.join(", ")} WHERE id = ?;`,
		values,
	);
	return getFoodById(id);
}

export async function deleteFood(id: number) {
	const result = await runSql("DELETE FROM foods WHERE id = ?;", [id]);
	return result.changes?.changes ?? 0;
}
