import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { parseBackupJson, type MunchlingBackup } from "../../shared/domain/backup";

const foodInput = { nameDe: "Nudeln", nameEn: "Pasta", ean: "123", caloriesPer100g: 200, fatPer100g: 2, carbsPer100g: 30, sugarPer100g: 3, fiberPer100g: 4, proteinPer100g: 10, saltPer100g: 0.5 };

async function populate(test: Awaited<ReturnType<typeof createTestDatabase>>) {
	const profile = (await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 2000, dailySaltTarget: 5 }))!;
	const food = (await test.service.foods.createFood(foodInput))!;
	const sub = (await test.service.recipes.createRecipe({ nameDe: "Untergericht", nameEn: "Sub", isSubRecipe: true, ingredients: [{ foodId: food.id, amountGrams: 150 }] }))!;
	const recipe = (await test.service.recipes.createRecipe({ nameDe: "Gericht", nameEn: "Dish", description: "Test", ingredients: [{ subRecipeId: sub.id, amountGrams: 200 }] }))!;
	await test.service.mealLogs.createMealLog({ loggedAt: "2026-10-05 12:00:00", recipeId: recipe.id, profiles: [{ profileId: profile.id, portionGrams: 100.125 }] });
	return { profile, food, recipe };
}

describe("local JSON backups", () => {
	let source: Awaited<ReturnType<typeof createTestDatabase>>;
	let target: Awaited<ReturnType<typeof createTestDatabase>>;
	let backup: MunchlingBackup;
	beforeEach(async () => {
		source = await createTestDatabase();
		target = await createTestDatabase();
		await populate(source);
		backup = await source.service.backups!.exportBackup();
	});
	afterEach(() => { source.close(); target.close(); });

	it("roundtrips all six tables with exact IDs, timestamps and stored portion factors", async () => {
		const writer = vi.fn(async (_backup: MunchlingBackup) => {});
		await target.service.backups!.restoreBackup(parseBackupJson(JSON.stringify(backup)), writer);
		const restored = await target.service.backups!.exportBackup();
		expect(restored.data).toEqual(backup.data);
		expect(writer).toHaveBeenCalledTimes(1);
		expect(writer.mock.calls[0]?.[0]).toMatchObject({ data: { profiles: [], foods: [], recipes: [] } });
	});

	it("saves the previous full data set before any delete", async () => {
		await populate(target);
		await target.service.profiles.updateProfile(1, { name: "Existing" });
		const previous = await target.service.backups!.exportBackup();
		const events: string[] = [];
		const run = target.driver.run;
		vi.spyOn(target.driver, "run").mockImplementation(async (statement, values) => {
			if (statement.startsWith("DELETE")) events.push("delete");
			return run(statement, values);
		});
		await target.service.backups!.restoreBackup(backup, async (saved) => {
			expect(saved.data).toEqual(previous.data);
			events.push("safety saved");
		});
		expect(events[0]).toBe("safety saved");
	});

	it("does not change current data when safety backup storage fails", async () => {
		await populate(target);
		const previous = await target.service.backups!.exportBackup();
		target.persist.mockClear();
		await expect(target.service.backups!.restoreBackup(backup, async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
		expect(target.persist).not.toHaveBeenCalled();
		expect((await target.service.backups!.exportBackup()).data).toEqual(previous.data);
	});

	it("rolls back deletion and partial insertion if SQL fails during restore", async () => {
		await populate(target);
		await target.service.profiles.updateProfile(1, { name: "Existing" });
		const previous = await target.service.backups!.exportBackup();
		const run = target.driver.run;
		vi.spyOn(target.driver, "run").mockImplementation(async (statement, values) => {
			if (statement.startsWith("INSERT INTO recipes")) throw new Error("write failed");
			return run(statement, values);
		});
		await expect(target.service.backups!.restoreBackup(backup, async () => {})).rejects.toThrow("write failed");
		expect((await target.service.backups!.exportBackup()).data).toEqual(previous.data);
	});

	it("rejects malformed input before saving or touching data", async () => {
		const writer = vi.fn(async () => {});
		const invalid = structuredClone(backup);
		invalid.data.recipeIngredients[0]!.foodId = 999;
		await expect(target.service.backups!.restoreBackup(invalid, writer)).rejects.toMatchObject({ code: "reference" });
		expect(writer).not.toHaveBeenCalled();
		expect(await target.service.profiles.listProfiles()).toEqual([]);
	});

	it("detaches imported data so a callback cannot mutate the restore input", async () => {
		await target.service.backups!.restoreBackup(backup, async () => { backup.data.profiles[0]!.name = "Changed after validation"; });
		expect((await target.service.profiles.listProfiles())[0]?.name).toBe("A");
	});

	it("keeps concurrently queued writes out of the snapshot/restore transaction", async () => {
		let concurrent!: Promise<unknown>;
		await target.service.backups!.restoreBackup(backup, async () => {
			concurrent = target.service.profiles.createProfile({ name: "Queued", dailyCaloriesTarget: 1000 });
		});
		await concurrent;
		expect((await target.service.profiles.listProfiles()).map((p) => p.name)).toEqual(["A", "Queued"]);
	});

	it("preserves existing meals with no profile links after profile deletion", async () => {
		await source.service.profiles.deleteProfile(1);
		const orphanedMealBackup = await source.service.backups!.exportBackup();
		await target.service.backups!.restoreBackup(orphanedMealBackup, async () => {});
		expect((await target.service.backups!.exportBackup()).data).toEqual(orphanedMealBackup.data);
	});

	it("can restore the safety backup back into a populated database", async () => {
		await populate(target);
		await target.service.profiles.updateProfile(1, { name: "Previous" });
		let recovery!: MunchlingBackup;
		await target.service.backups!.restoreBackup(backup, async (previous) => { recovery = previous; });
		await target.service.backups!.restoreBackup(recovery, async () => {});
		expect((await target.service.profiles.listProfiles())[0]?.name).toBe("Previous");
	});

	it("does not restore schema migration metadata or reset identity sequences", async () => {
		await target.database.run("INSERT INTO schema_migrations (version, name) VALUES (1, 'initial_schema');");
		await target.service.backups!.restoreBackup(backup, async () => {});
		expect(await target.database.query("SELECT version FROM schema_migrations;")).toEqual([{ version: 1 }]);
		const profile = await target.service.profiles.createProfile({ name: "Next", dailyCaloriesTarget: 1 });
		expect(profile!.id).toBeGreaterThan(backup.data.profiles[0]!.id);
	});

	it("refuses export/restore if unknown newer schema metadata is present", async () => {
		await target.database.run("INSERT INTO schema_migrations (version, name) VALUES (2, 'future');");
		await expect(target.service.backups!.exportBackup()).rejects.toMatchObject({ code: "backupFormat" });
		await expect(target.service.backups!.restoreBackup(backup, async () => {})).rejects.toMatchObject({ code: "backupFormat" });
	});
});
