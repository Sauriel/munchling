import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { calculateMealLogProfileNutrition } from "../../shared/domain/nutrition";
import type { CreateFoodInput } from "../../shared/domain/types";

const foodInput: CreateFoodInput = {
	nameDe: "Nudeln", nameEn: "Pasta", caloriesPer100g: 200,
	fatPer100g: 2, carbsPer100g: 30, sugarPer100g: 3,
	fiberPer100g: 4, proteinPer100g: 10, saltPer100g: 0.5,
};

describe("local data service with real SQLite", () => {
	let test: Awaited<ReturnType<typeof createTestDatabase>>;
	let foodId: number;
	let profileId: number;
	beforeEach(async () => {
		test = await createTestDatabase();
		foodId = (await test.service.foods.createFood(foodInput))!.id;
		profileId = (await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 2000 }))!.id;
		test.persist.mockClear();
	});
	afterEach(() => test.close());

	it("creates a complete recipe and persists only once", async () => {
		const recipe = await test.service.recipes.createRecipe({
			nameDe: "Gericht", nameEn: "Dish",
			ingredients: [{ foodId, amountGrams: 100 }, { foodId, amountGrams: 50 }],
		});
		expect(recipe?.ingredients).toHaveLength(2);
		expect(test.persist).toHaveBeenCalledTimes(1);
	});

	it("rolls back the parent and previously inserted ingredients after a failed create", async () => {
		await expect(test.service.recipes.createRecipe({
			nameDe: "Gericht", nameEn: "Dish",
			ingredients: [{ foodId, amountGrams: 100 }, { foodId: 999, amountGrams: 50 }],
		})).rejects.toThrow();
		expect(await test.service.recipes.listRecipes()).toEqual([]);
		expect(await test.database.query("SELECT * FROM recipe_ingredients;")).toEqual([]);
		expect(test.persist).not.toHaveBeenCalled();
	});

	it("restores recipe metadata and ingredients after a failed update", async () => {
		const recipe = (await test.service.recipes.createRecipe({
			nameDe: "Original", nameEn: "Original", ingredients: [{ foodId, amountGrams: 100 }],
		}))!;
		test.persist.mockClear();
		await expect(test.service.recipes.updateRecipe(recipe.id, {
			nameDe: "Changed", ingredients: [{ foodId, amountGrams: 40 }, { foodId: 999, amountGrams: 50 }],
		})).rejects.toThrow();
		expect(await test.service.recipes.getRecipeWithIngredients(recipe.id)).toEqual(recipe);
		expect(test.persist).not.toHaveBeenCalled();
	});

	it("restores the old ingredient list after a failed replacement", async () => {
		const recipe = (await test.service.recipes.createRecipe({
			nameDe: "Original", nameEn: "Original", ingredients: [{ foodId, amountGrams: 100 }],
		}))!;
		await expect(test.service.recipes.replaceRecipeIngredients(recipe.id, [
			{ foodId, amountGrams: 25 }, { foodId, amountGrams: -1 },
		])).rejects.toThrow();
		expect(await test.service.recipes.listRecipeIngredients(recipe.id)).toEqual(recipe.ingredients);
	});

	it("replaces ingredients without nested transactions and can use subrecipes", async () => {
		const child = (await test.service.recipes.createRecipe({
			nameDe: "Untergericht", nameEn: "Subrecipe", ingredients: [{ foodId, amountGrams: 100 }],
		}))!;
		const parent = (await test.service.recipes.createRecipe({ nameDe: "Hauptgericht", nameEn: "Main" }))!;
		test.persist.mockClear();
		await test.service.recipes.replaceRecipeIngredients(parent.id, [{ subRecipeId: child.id, amountGrams: 200 }]);
		expect((await test.service.recipes.calculateRecipeNutrition(parent.id)).total.calories).toBe(400);
		expect(test.persist).toHaveBeenCalledTimes(1);
	});

	it("atomically creates a meal with multiple portions", async () => {
		const second = (await test.service.profiles.createProfile({ name: "B", dailyCaloriesTarget: 1800 }))!;
		test.persist.mockClear();
		const meal = (await test.service.mealLogs.createMealLog({
			foodId, loggedAt: "2026-10-05 12:00:00",
			profiles: [{ profileId, portionGrams: 150 }, { profileId: second.id, portionGrams: 250 }],
		}))!;
		expect(meal.totalWeightGrams).toBe(400);
		expect(meal.profiles.map((p) => p.portionGrams)).toEqual([150, 250]);
		expect(calculateMealLogProfileNutrition(meal, profileId).calories).toBe(300);
		expect(test.persist).toHaveBeenCalledTimes(1);
	});

	it("rolls back a meal when a referenced profile does not exist", async () => {
		await expect(test.service.mealLogs.createMealLog({
			foodId, profiles: [{ profileId, portionGrams: 100 }, { profileId: 999, portionGrams: 100 }],
		})).rejects.toThrow();
		expect(await test.service.mealLogs.listMealLogs()).toEqual([]);
		expect(await test.database.query("SELECT * FROM meal_log_profiles;")).toEqual([]);
	});

	it("restores meal metadata and portions after a failed update", async () => {
		const meal = (await test.service.mealLogs.createMealLog({
			foodId, loggedAt: "2026-10-05 12:00:00", profiles: [{ profileId, portionGrams: 100 }],
		}))!;
		test.persist.mockClear();
		await expect(test.service.mealLogs.updateMealLog(meal.id, {
			foodId, loggedAt: "2026-10-06 12:00:00",
			profiles: [{ profileId, portionGrams: 200 }, { profileId: 999, portionGrams: 100 }],
		})).rejects.toThrow();
		expect(await test.service.mealLogs.getMealLogById(meal.id)).toEqual(meal);
		expect(test.persist).not.toHaveBeenCalled();
	});

	it("rolls back duplicate profile portions", async () => {
		await expect(test.service.mealLogs.createMealLog({
			foodId, profiles: [{ profileId, portionGrams: 100 }, { profileId, portionGrams: 100 }],
		})).rejects.toThrow();
		expect(await test.service.mealLogs.listMealLogs()).toEqual([]);
	});

	it("filters meals by profile and date", async () => {
		await test.service.mealLogs.createMealLog({ foodId, loggedAt: "2026-10-05 12:00:00", profiles: [{ profileId, portionGrams: 100 }] });
		expect(await test.service.mealLogs.listMealLogs({ profileId, date: "2026-10-05" })).toHaveLength(1);
		expect(await test.service.mealLogs.listMealLogs({ profileId, date: "2026-10-06" })).toHaveLength(0);
		expect(await test.service.mealLogs.listMealLogs({ profileId: 999 })).toHaveLength(0);
	});

	it("keeps historical nutrition dynamic when a food changes", async () => {
		const meal = (await test.service.mealLogs.createMealLog({ foodId, profiles: [{ profileId, portionGrams: 100 }] }))!;
		await test.service.foods.updateFood(foodId, { caloriesPer100g: 300 });
		expect((await test.service.mealLogs.getMealLogById(meal.id))?.nutritionPer100g.calories).toBe(300);
	});

	it("supports explicit null and zero in partial profile updates", async () => {
		await test.service.profiles.updateProfile(profileId, { dailyProteinTarget: 80 });
		const profile = await test.service.profiles.updateProfile(profileId, { dailyProteinTarget: null, dailyCaloriesTarget: 0 });
		expect(profile?.dailyProteinTarget).toBeNull();
		expect(profile?.dailyCaloriesTarget).toBe(0);
		expect(profile?.name).toBe("A");
	});

	it("supports clearing optional food values without touching other fields", async () => {
		await test.service.foods.updateFood(foodId, { ean: "123", brand: "Brand", isCustom: false });
		const food = await test.service.foods.updateFood(foodId, { ean: null, brand: " ", fatPer100g: 0 });
		expect(food?.ean).toBeNull();
		expect(food?.brand).toBeNull();
		expect(food?.isCustom).toBe(false);
		expect(food?.fatPer100g).toBe(0);
		expect(food?.nameDe).toBe("Nudeln");
	});

	it("uses parameterized values for names with SQL punctuation", async () => {
		const name = "x'; DROP TABLE foods; --";
		const food = await test.service.foods.updateFood(foodId, { nameDe: name });
		expect(food?.nameDe).toBe(name);
		expect(await test.service.foods.listFoods()).toHaveLength(1);
	});

	it("rejects non-finite or empty meal portions", async () => {
		for (const portions of [[], [{ profileId, portionGrams: NaN }], [{ profileId, portionGrams: Infinity }]]) {
			await expect(test.service.mealLogs.createMealLog({ foodId, profiles: portions })).rejects.toThrow();
		}
		expect(await test.service.mealLogs.listMealLogs()).toEqual([]);
	});
});
