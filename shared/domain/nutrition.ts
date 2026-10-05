import type { Food, MealLog, NutritionValues, RecipeIngredient, RecipeNutrition } from "./types";

export const emptyNutrition = (): NutritionValues => ({
	calories: 0, fat: 0, carbs: 0, sugar: 0, fiber: 0, protein: 0, salt: 0,
});

export function foodNutrition(food: Food): NutritionValues {
	return {
		calories: food.caloriesPer100g, fat: food.fatPer100g,
		carbs: food.carbsPer100g, sugar: food.sugarPer100g,
		fiber: food.fiberPer100g, protein: food.proteinPer100g, salt: food.saltPer100g,
	};
}

export function roundNutrition(values: NutritionValues): NutritionValues {
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

function multiplyNutrition(values: NutritionValues, factor: number): NutritionValues {
	return {
		calories: values.calories * factor, fat: values.fat * factor,
		carbs: values.carbs * factor, sugar: values.sugar * factor,
		fiber: values.fiber * factor, protein: values.protein * factor, salt: values.salt * factor,
	};
}

export function scaleNutrition(values: NutritionValues, grams: number): NutritionValues {
	return roundNutrition(multiplyNutrition(values, grams / 100));
}

export function calculateMealLogProfileNutrition(mealLog: MealLog, profileId: number): NutritionValues {
	const profile = mealLog.profiles.find((item) => item.profileId === profileId);
	return profile ? scaleNutrition(mealLog.nutritionPer100g, profile.portionGrams) : emptyNutrition();
}

export interface NutritionSource {
	listRecipeIngredients(recipeId: number): Promise<RecipeIngredient[]>;
	getFoodById(foodId: number): Promise<Food | null>;
}

// No SQLite, Nuxt or HTTP dependency: both adapters supply the same read contract.
// Keep the existing rounding of nested recipes and dynamic historical nutrition.
export async function calculateRecipeNutrition(
	source: NutritionSource,
	recipeId: number,
	visitedRecipeIds = new Set<number>(),
): Promise<RecipeNutrition> {
	if (visitedRecipeIds.has(recipeId)) {
		throw new Error(`Circular recipe reference detected for recipe ${recipeId}.`);
	}
	const visited = new Set(visitedRecipeIds);
	visited.add(recipeId);
	const ingredients = await source.listRecipeIngredients(recipeId);
	const total = emptyNutrition();
	let totalWeightGrams = 0;

	for (const ingredient of ingredients) {
		totalWeightGrams += ingredient.amountGrams;
		let values: NutritionValues | null = null;
		if (ingredient.foodId !== null) {
			const food = await source.getFoodById(ingredient.foodId);
			if (food) values = foodNutrition(food);
		} else if (ingredient.subRecipeId !== null) {
			values = (await calculateRecipeNutrition(source, ingredient.subRecipeId, visited)).per100g;
		}
		if (values) {
			const scaled = multiplyNutrition(values, ingredient.amountGrams / 100);
			for (const key of Object.keys(total) as (keyof NutritionValues)[]) {
				total[key] += scaled[key];
			}
		}
	}

	return {
		totalWeightGrams: Math.round(totalWeightGrams * 100) / 100,
		total: roundNutrition(total),
		per100g: totalWeightGrams > 0
			? roundNutrition(multiplyNutrition(total, 100 / totalWeightGrams))
			: emptyNutrition(),
	};
}
