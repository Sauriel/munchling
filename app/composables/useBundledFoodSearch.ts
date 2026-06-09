import initSqlJs, { type Database } from "sql.js";

export type BundledFoodSearchResult = {
	id: number;
	blsCode: string;
	nameDe: string;
	nameEn: string;
	caloriesPer100g: number;
	fatPer100g: number;
	carbsPer100g: number;
	sugarPer100g: number;
	fiberPer100g: number;
	proteinPer100g: number;
	saltPer100g: number;
};

type BundledFoodRow = [
	number,
	string,
	string,
	string,
	number,
	number,
	number,
	number,
	number,
	number,
	number,
];

let databasePromise: Promise<Database> | null = null;

function rowToResult(row: unknown[]): BundledFoodSearchResult {
	const [
		id,
		blsCode,
		nameDe,
		nameEn,
		caloriesPer100g,
		fatPer100g,
		carbsPer100g,
		sugarPer100g,
		fiberPer100g,
		proteinPer100g,
		saltPer100g,
	] = row as BundledFoodRow;

	return {
		id,
		blsCode,
		nameDe,
		nameEn,
		caloriesPer100g,
		fatPer100g,
		carbsPer100g,
		sugarPer100g,
		fiberPer100g,
		proteinPer100g,
		saltPer100g,
	};
}

async function loadBundledFoodDatabase() {
	databasePromise ??= (async () => {
		const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
		const response = await fetch("/databases/bls-foods.db");

		if (!response.ok) {
			throw new Error(
				`Bundled food database request failed with HTTP ${response.status}`,
			);
		}

		return new SQL.Database(new Uint8Array(await response.arrayBuffer()));
	})();

	return databasePromise;
}

export function useBundledFoodSearch() {
	const bundledFoodResults = useState<BundledFoodSearchResult[]>(
		"bundled-food-results",
		() => [],
	);
	const isSearchingBundledFoods = useState(
		"bundled-foods-searching",
		() => false,
	);
	const bundledFoodSearchError = useState<string | null>(
		"bundled-foods-error",
		() => null,
	);

	const searchBundledFoods = async (term: string) => {
		const trimmedTerm = term.trim().toLowerCase();

		if (trimmedTerm.length < 2) {
			bundledFoodResults.value = [];
			return [];
		}

		isSearchingBundledFoods.value = true;
		bundledFoodSearchError.value = null;

		try {
			const database = await loadBundledFoodDatabase();
			const escapedTerm = trimmedTerm.replace(
				/[\\%_]/g,
				(match) => `\\${match}`,
			);
			const result = database.exec(
				`
          SELECT
            id,
            bls_code,
            name_de,
            name_en,
            calories_per_100g,
            fat_per_100g,
            carbs_per_100g,
            sugar_per_100g,
            fiber_per_100g,
            protein_per_100g,
            salt_per_100g
          FROM bundled_foods
          WHERE search_text LIKE ? ESCAPE '\\'
          ORDER BY
            CASE
              WHEN lower(name_de) LIKE ? ESCAPE '\\' THEN 0
              WHEN lower(name_en) LIKE ? ESCAPE '\\' THEN 1
              ELSE 2
            END,
            name_de COLLATE NOCASE ASC
          LIMIT 25;
        `,
				[`%${escapedTerm}%`, `${escapedTerm}%`, `${escapedTerm}%`],
			);
			const rows = result[0]?.values ?? [];
			bundledFoodResults.value = rows.map(rowToResult);
			return bundledFoodResults.value;
		} catch (error) {
			bundledFoodSearchError.value =
				error instanceof Error ? error.message : String(error);
			bundledFoodResults.value = [];
			return [];
		} finally {
			isSearchingBundledFoods.value = false;
		}
	};

	return {
		bundledFoodResults,
		isSearchingBundledFoods,
		bundledFoodSearchError,
		searchBundledFoods,
	};
}
