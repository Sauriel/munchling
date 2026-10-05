import { describe, expect, it } from "vitest";
import { calculateRecipeNutrition, emptyNutrition, scaleNutrition, type NutritionSource } from "../../shared/domain/nutrition";
import type { Food, RecipeIngredient } from "../../shared/domain/types";

const food: Food = {
	id: 1, nameDe: "Test", nameEn: "Test", brand: null, ean: null,
	caloriesPer100g: 200, fatPer100g: 2, carbsPer100g: 30, sugarPer100g: 3,
	fiberPer100g: 4, proteinPer100g: 10, saltPer100g: 0.5,
	isCustom: true, createdAt: "2026-10-05", updatedAt: null,
};
const ingredient = (recipeId: number, amountGrams: number, subRecipeId: number | null = null): RecipeIngredient => ({
	id: 1, recipeId, foodId: subRecipeId === null ? food.id : null,
	subRecipeId, amountGrams, createdAt: "2026-10-05",
});
const source = (recipes: Record<number, RecipeIngredient[]>): NutritionSource => ({
	listRecipeIngredients: async (id) => recipes[id] ?? [],
	getFoodById: async () => food,
});

describe("persistence-independent nutrition", () => {
	it("calculates total and per-100g nutrition", async () => {
		const result = await calculateRecipeNutrition(source({ 1: [ingredient(1, 250)] }), 1);
		expect(result.totalWeightGrams).toBe(250);
		expect(result.total.calories).toBe(500);
		expect(result.per100g.calories).toBe(200);
		expect(result.total.salt).toBe(1.25);
	});

	it("returns zeros for an empty recipe", async () => {
		expect(await calculateRecipeNutrition(source({}), 1)).toEqual({ totalWeightGrams: 0, total: emptyNutrition(), per100g: emptyNutrition() });
	});

	it("allows repeated use of the same subrecipe without a false cycle", async () => {
		const result = await calculateRecipeNutrition(source({
			1: [ingredient(1, 100, 2), ingredient(1, 50, 2)],
			2: [ingredient(2, 100)],
		}), 1);
		expect(result.total.calories).toBe(300);
	});

	it("detects direct and indirect circular recipe references", async () => {
		await expect(calculateRecipeNutrition(source({ 1: [ingredient(1, 100, 1)] }), 1)).rejects.toThrow("Circular recipe reference");
		await expect(calculateRecipeNutrition(source({
			1: [ingredient(1, 100, 2)], 2: [ingredient(2, 100, 1)],
		}), 1)).rejects.toThrow("Circular recipe reference");
	});

	it("does not mutate a caller-owned visited set", async () => {
		const visited = new Set([9]);
		await calculateRecipeNutrition(source({}), 1, visited);
		expect([...visited]).toEqual([9]);
	});

	it("keeps the existing calorie and nutrient rounding", () => {
		expect(scaleNutrition({ ...emptyNutrition(), calories: 123, protein: 1.234 }, 150)).toEqual({
			...emptyNutrition(), calories: 185, protein: 1.85,
		});
	});
});
