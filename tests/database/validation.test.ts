import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { DomainValidationError } from "../../shared/domain/validation";

describe("repository validation", () => {
	let test: Awaited<ReturnType<typeof createTestDatabase>>;
	beforeEach(async () => { test = await createTestDatabase(); });
	afterEach(() => test.close());
	it("rejects invalid data even when invoked without the UI", async () => {
		await expect(test.service.profiles.createProfile({ name: " ", dailyCaloriesTarget: 2000 })).rejects.toThrow(DomainValidationError);
		expect(await test.service.profiles.listProfiles()).toEqual([]);
	});
	it("rejects an indirect recipe cycle and rolls back metadata and new ingredients", async () => {
		const a = (await test.service.recipes.createRecipe({ nameDe: "A", nameEn: "A" }))!;
		const b = (await test.service.recipes.createRecipe({ nameDe: "B", nameEn: "B", ingredients: [{ subRecipeId: a.id, amountGrams: 100 }] }))!;
		await expect(test.service.recipes.updateRecipe(a.id, { nameDe: "Changed", ingredients: [{ subRecipeId: b.id, amountGrams: 100 }] })).rejects.toMatchObject({ code: "cycle" });
		expect(await test.service.recipes.getRecipeWithIngredients(a.id)).toEqual(a);
	});
	it("checks ingredient updates as well as replacements for cycles", async () => {
		const a = (await test.service.recipes.createRecipe({ nameDe: "A", nameEn: "A" }))!;
		const b = (await test.service.recipes.createRecipe({ nameDe: "B", nameEn: "B" }))!;
		const c = (await test.service.recipes.createRecipe({ nameDe: "C", nameEn: "C" }))!;
		const ingredient = (await test.service.recipes.addRecipeIngredient(a.id, { subRecipeId: b.id, amountGrams: 100 }))!;
		await test.service.recipes.addRecipeIngredient(c.id, { subRecipeId: a.id, amountGrams: 100 });
		await expect(test.service.recipes.updateRecipeIngredient(ingredient.id, { subRecipeId: c.id, amountGrams: 100 })).rejects.toMatchObject({ code: "cycle" });
		expect(await test.service.recipes.getRecipeIngredientById(ingredient.id)).toEqual(ingredient);
	});
	it("reports missing references without creating partial records", async () => {
		await expect(test.service.recipes.createRecipe({ nameDe: "A", nameEn: "A", ingredients: [{ foodId: 999, amountGrams: 100 }] })).rejects.toMatchObject({ code: "reference" });
		await expect(test.service.recipes.replaceRecipeIngredients(999, [])).rejects.toMatchObject({ code: "reference" });
		expect(await test.service.recipes.listRecipes()).toEqual([]);
	});
	it("serializes EAN checks with writes so concurrent duplicate creates are rejected", async () => {
		const input = { nameDe: "Food", nameEn: "Food", ean: "123", caloriesPer100g: 1, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 };
		const results = await Promise.allSettled([test.service.foods.createFood(input), test.service.foods.createFood(input)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		const rejected = results.find((result) => result.status === "rejected");
		expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "duplicate", field: "ean" });
		expect(await test.service.foods.listFoods()).toHaveLength(1);
		const existing = (await test.service.foods.listFoods())[0]!;
		await expect(test.service.foods.updateFood(existing.id, { ean: "123" })).resolves.not.toBeNull();
	});
	it("returns null for nonexistent aggregate updates without creating children", async () => {
		expect(await test.service.recipes.updateRecipe(999, { nameDe: "Test" })).toBeNull();
		expect(await test.service.mealLogs.updateMealLog(999, { foodId: 1, profiles: [{ profileId: 1, portionGrams: 100 }] })).toBeNull();
	});
});
