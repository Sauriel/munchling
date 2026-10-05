import { describe, expect, it } from "vitest";
import { MAX_BACKUP_BYTES, cloneBackup, parseBackupJson, type MunchlingBackup } from "../../shared/domain/backup";

const empty: MunchlingBackup = {
	format: "munchling-backup", version: 1, schemaVersion: 1, exportedAt: "2026-10-05T12:00:00Z",
	data: { profiles: [], foods: [], recipes: [], recipeIngredients: [], mealLogs: [], mealLogProfiles: [] },
};
const profile = { id: 1, name: "A", dailyCaloriesTarget: 2000, dailyProteinTarget: null, dailyCarbsTarget: null, dailyFatTarget: null, dailySugarTarget: null, dailyFiberTarget: null, dailySaltTarget: null, createdAt: "2026-10-05 12:00:00", updatedAt: null };

function valid(): MunchlingBackup {
	const backup = structuredClone(empty);
	backup.data.profiles = [structuredClone(profile)];
	backup.data.foods = [{ id: 1, nameDe: "Food", nameEn: "Food", brand: null, ean: "123", caloriesPer100g: 1, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0, isCustom: true, createdAt: profile.createdAt, updatedAt: null }];
	backup.data.recipes = [{ id: 1, nameDe: "Recipe", nameEn: "Recipe", description: null, isSubRecipe: false, createdAt: profile.createdAt, updatedAt: null }];
	backup.data.recipeIngredients = [{ id: 1, recipeId: 1, foodId: 1, subRecipeId: null, amountGrams: 100, createdAt: profile.createdAt }];
	backup.data.mealLogs = [{ id: 1, loggedAt: profile.createdAt, foodId: 1, recipeId: null, totalWeightGrams: 100, createdAt: profile.createdAt, updatedAt: null }];
	backup.data.mealLogProfiles = [{ id: 1, mealLogId: 1, profileId: 1, portionFactor: 1, createdAt: profile.createdAt }];
	return backup;
}

describe("backup format validation", () => {
	it("accepts an explicitly empty data set", () => {
		expect(parseBackupJson(JSON.stringify(empty))).toEqual(empty);
	});
	it("accepts a complete backup", () => { expect(cloneBackup(valid())).toEqual(valid()); });
	it.each(["garbage", "null", "[]", "{}"])("rejects invalid JSON/root: %s", (value) => {
		expect(() => parseBackupJson(value)).toThrow();
	});
	it.each([{ ...empty, version: 2 }, { ...empty, schemaVersion: 2 }, { ...empty, format: "other" }])("rejects unsupported format/version", (value) => {
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects missing tables rather than interpreting them as empty", () => {
		const value = structuredClone(empty) as unknown as { data: Record<string, unknown> };
		delete value.data.foods;
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects missing nullable fields as well as invalid field types", () => {
		const value = valid();
		delete (value.data.profiles[0] as Partial<typeof profile>).dailyProteinTarget;
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects duplicate record IDs", () => {
		const value = valid(); value.data.profiles.push({ ...profile });
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects duplicate EANs", () => {
		const value = valid(); value.data.foods.push({ ...value.data.foods[0]!, id: 2 });
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects missing references and invalid recipe cycles", () => {
		const value = valid(); value.data.recipeIngredients[0]!.foodId = 999;
		expect(() => cloneBackup(value)).toThrow();
		value.data.recipeIngredients[0]!.foodId = null;
		value.data.recipeIngredients[0]!.subRecipeId = 1;
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects duplicate meal-profile pairs with different IDs", () => {
		const value = valid(); value.data.mealLogProfiles.push({ ...value.data.mealLogProfiles[0]!, id: 2 });
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects corrupt dates and non-finite portion factors", () => {
		const value = valid(); value.data.mealLogs[0]!.loggedAt = "2026-02-30 12:00:00";
		expect(() => cloneBackup(value)).toThrow();
		value.data.mealLogs[0]!.loggedAt = profile.createdAt;
		value.data.mealLogProfiles[0]!.portionFactor = Infinity;
		expect(() => cloneBackup(value)).toThrow();
	});
	it("enforces byte and row limits", () => {
		expect(() => parseBackupJson(" ".repeat(MAX_BACKUP_BYTES + 1))).toThrow();
		const value = structuredClone(empty);
		value.data.profiles = Array.from({ length: 100001 }, () => profile);
		expect(() => cloneBackup(value)).toThrow();
	});
	it("rejects circular objects without exposing stringify failures", () => {
		const value: Record<string, unknown> = {}; value.self = value;
		expect(() => cloneBackup(value)).toThrow("backupFormat");
	});
});
