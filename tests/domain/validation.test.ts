import { describe, expect, it } from "vitest";
import { assertDateTime, DomainValidationError, validateFoodInput, validateIngredientInput, validateMealInput, validateProfileInput, validateRecipeGraph, validateRecipeInput } from "../../shared/domain/validation";

const food = { nameDe: "Test", nameEn: "Test", caloriesPer100g: 0, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 };

describe("shared input validation", () => {
	it.each([NaN, Infinity, -1, "5", null])("rejects invalid food numbers: %s", (value) => {
		expect(() => validateFoodInput({ ...food, proteinPer100g: value })).toThrow(DomainValidationError);
	});
	it("allows zeros and explicit null for optional profile targets", () => {
		expect(() => validateProfileInput({ name: "A", dailyCaloriesTarget: 0, dailyProteinTarget: null })).not.toThrow();
		expect(() => validateProfileInput({ dailyProteinTarget: null }, true)).not.toThrow();
	});
	it.each(["", "  ", null, 12])("rejects invalid names: %s", (name) => {
		expect(() => validateProfileInput({ name, dailyCaloriesTarget: 2000 })).toThrow();
		expect(() => validateFoodInput({ ...food, nameDe: name })).toThrow();
		expect(() => validateRecipeInput({ nameDe: name, nameEn: "Test" })).toThrow();
	});
	it("checks provided patch fields without requiring absent fields", () => {
		expect(() => validateFoodInput({ brand: null, isCustom: false }, true)).not.toThrow();
		expect(() => validateFoodInput({ proteinPer100g: null }, true)).toThrow();
		expect(() => validateRecipeInput({ ingredients: [] }, true)).not.toThrow();
		expect(() => validateRecipeInput({ isSubRecipe: "false" }, true)).toThrow();
	});
	it("rejects fractional calorie targets and wrong optional types", () => {
		expect(() => validateProfileInput({ name: "A", dailyCaloriesTarget: 1.2 })).toThrow();
		expect(() => validateFoodInput({ ...food, brand: 123 })).toThrow();
	});
	it.each([
		{ amountGrams: 1 }, { foodId: 1, subRecipeId: 2, amountGrams: 1 },
		{ foodId: 0, amountGrams: 1 }, { foodId: 1.5, amountGrams: 1 },
		{ foodId: 1, amountGrams: 0 }, { foodId: 1, amountGrams: Infinity },
	])("rejects invalid ingredient %j", (value) => {
		expect(() => validateIngredientInput(value)).toThrow();
	});
	it("requires exactly one meal source and unique positive portions", () => {
		const profiles = [{ profileId: 1, portionGrams: 100 }];
		expect(() => validateMealInput({ foodId: 1, recipeId: null, profiles })).not.toThrow();
		expect(() => validateMealInput({ foodId: 1, recipeId: 2, profiles })).toThrow();
		expect(() => validateMealInput({ foodId: 1, profiles: [...profiles, ...profiles] })).toThrow();
		expect(() => validateMealInput({ foodId: 1, profiles: [{ profileId: 1, portionGrams: -1 }] })).toThrow();
	});
	it.each(["2026-10-05 12:00:00", "2026-10-05T12:00", "2024-02-29T12:00:00.123Z", "2026-10-05T12:00:00+02:00"])("accepts date %s", (value) => {
		expect(() => assertDateTime(value, "date")).not.toThrow();
	});
	it.each(["", "not a date", "2026-02-29 12:00:00", "2026-02-30T12:00:00Z", "2026-13-01T12:00:00Z", "2026-01-01T24:00:00Z", "2026-01-01T12:00:00+99:00"])("rejects date %s", (value) => {
		expect(() => assertDateTime(value, "date")).toThrow();
	});
	it("allows shared and duplicate subrecipes but rejects cycles", () => {
		expect(() => validateRecipeGraph([{ recipeId: 1, subRecipeId: 2 }, { recipeId: 1, subRecipeId: 2 }, { recipeId: 3, subRecipeId: 2 }])).not.toThrow();
		expect(() => validateRecipeGraph([{ recipeId: 1, subRecipeId: 2 }, { recipeId: 2, subRecipeId: 3 }, { recipeId: 3, subRecipeId: 1 }])).toThrow();
	});
	it("validates deep recipe graphs without recursive stack growth", () => {
		const edges = Array.from({ length: 20000 }, (_, i) => ({ recipeId: i + 1, subRecipeId: i + 2 }));
		expect(() => validateRecipeGraph(edges)).not.toThrow();
	});
});
