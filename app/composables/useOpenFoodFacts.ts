export type OpenFoodFactsFood = {
	nameDe: string;
	nameEn: string;
	brand: string;
	ean: string;
	caloriesPer100g: number;
	fatPer100g: number;
	carbsPer100g: number;
	sugarPer100g: number;
	fiberPer100g: number;
	proteinPer100g: number;
	saltPer100g: number;
};

type OpenFoodFactsProduct = {
	product_name?: string;
	product_name_de?: string;
	product_name_en?: string;
	brands?: string;
	nutriments?: Record<string, number | string | undefined>;
};

type OpenFoodFactsResponse = {
	status?: number;
	product?: OpenFoodFactsProduct;
};

function numberFromNutriments(
	nutriments: Record<string, number | string | undefined>,
	key: string,
) {
	const value = nutriments[key];
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function caloriesFromNutriments(
	nutriments: Record<string, number | string | undefined>,
) {
	const calories = numberFromNutriments(nutriments, "energy-kcal_100g");

	if (calories > 0) {
		return Math.round(calories);
	}

	const energyKj = numberFromNutriments(nutriments, "energy_100g");
	return energyKj > 0 ? Math.round(energyKj / 4.184) : 0;
}

function firstNonEmpty(...values: Array<string | undefined>) {
	return values.map((value) => value?.trim()).find(Boolean) ?? "";
}

export function useOpenFoodFacts() {
	const isLookingUpProduct = useState(
		"open-food-facts-looking-up",
		() => false,
	);
	const productLookupError = useState<string | null>(
		"open-food-facts-error",
		() => null,
	);

	const lookupProductByEan = async (
		ean: string,
	): Promise<OpenFoodFactsFood | null> => {
		const normalizedEan = ean.trim();

		if (!normalizedEan) {
			return null;
		}

		isLookingUpProduct.value = true;
		productLookupError.value = null;

		try {
			const fields = [
				"product_name",
				"product_name_de",
				"product_name_en",
				"brands",
				"nutriments",
			].join(",");
			const response = await fetch(
				`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalizedEan)}.json?fields=${fields}`,
				{
					headers: {
						Accept: "application/json",
					},
				},
			);

			if (!response.ok) {
				throw new Error(
					`OpenFoodFacts request failed with HTTP ${response.status}`,
				);
			}

			const data = (await response.json()) as OpenFoodFactsResponse;

			if (data.status !== 1 || !data.product) {
				return null;
			}

			const product = data.product;
			const nutriments = product.nutriments ?? {};
			const fallbackName = firstNonEmpty(
				product.product_name,
				product.product_name_de,
				product.product_name_en,
			);

			return {
				nameDe: firstNonEmpty(product.product_name_de, fallbackName),
				nameEn: firstNonEmpty(product.product_name_en, fallbackName),
				brand: product.brands?.trim() ?? "",
				ean: normalizedEan,
				caloriesPer100g: caloriesFromNutriments(nutriments),
				fatPer100g: numberFromNutriments(nutriments, "fat_100g"),
				carbsPer100g: numberFromNutriments(nutriments, "carbohydrates_100g"),
				sugarPer100g: numberFromNutriments(nutriments, "sugars_100g"),
				fiberPer100g: numberFromNutriments(nutriments, "fiber_100g"),
				proteinPer100g: numberFromNutriments(nutriments, "proteins_100g"),
				saltPer100g: numberFromNutriments(nutriments, "salt_100g"),
			};
		} catch (error) {
			productLookupError.value =
				error instanceof Error ? error.message : String(error);
			return null;
		} finally {
			isLookingUpProduct.value = false;
		}
	};

	return {
		isLookingUpProduct,
		productLookupError,
		lookupProductByEan,
	};
}
