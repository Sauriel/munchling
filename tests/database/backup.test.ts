import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { parseBackupJson, type MunchlingBackup } from "../../shared/domain/backup";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createUuid } from "../../shared/domain/sync";

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
		const versions = await target.database.query("SELECT version FROM schema_migrations ORDER BY version;");
		await target.service.backups!.restoreBackup(backup, async () => {});
		expect(await target.database.query("SELECT version FROM schema_migrations ORDER BY version;")).toEqual(versions);
		const profile = await target.service.profiles.createProfile({ name: "Next", dailyCaloriesTarget: 1 });
		expect(profile!.id).toBeGreaterThan(backup.data.profiles[0]!.id);
	});

	it("preserves v2 UUIDs and all relationship tombstones", async () => {
		await source.service.foods.deleteFood(1);
		const deleted = await source.service.backups!.exportBackup();
		expect(deleted.version).toBe(3);
		await target.service.backups!.restoreBackup(deleted, async () => {});
		const restored = await target.service.backups!.exportBackup();
		if (deleted.version === 1 || restored.version === 1) throw new Error("expected identities");
		expect(restored.identities).toEqual(deleted.identities);
		expect(restored.tombstones).toEqual(deleted.tombstones);
		expect(restored.data).toEqual(deleted.data);
	});

	it("imports v1 data with new UUIDs on each restore, retaining numeric IDs and exact portions", async () => {
		const legacy = { format: "munchling-backup", version: 1, schemaVersion: 1, exportedAt: backup.exportedAt, data: backup.data };
		await target.service.backups!.restoreBackup(legacy, async () => {});
		const first = await target.service.backups!.exportBackup();
		await target.service.backups!.restoreBackup(legacy, async () => {});
		const second = await target.service.backups!.exportBackup();
		if (first.version === 1 || second.version === 1) throw new Error("expected identities");
		expect(second.data).toEqual(legacy.data);
		expect(second.identities.map((row) => row.uuid)).not.toEqual(first.identities.map((row) => row.uuid));
		expect(second.tombstones).toEqual([]);
	});

	it("detaches server binding, resets synchronization and queues one new snapshot batch after restore", async () => {
		await populate(target);
		const old = (await target.database.query<{ device_id: string; local_epoch: string }>("SELECT device_id,local_epoch FROM sync_state;"))[0]!;
		const queue = createSyncQueue(target.database);
		const previous = await queue.list();
		await target.database.run("UPDATE sync_state SET enabled=1,server_url='https://old.example',server_instance_id='old-instance',pull_cursor='42';");
		await target.database.run("INSERT INTO sync_conflicts (uuid,local_payload,remote_payload,server_revision) VALUES (?,?,?,?);", [previous[0]!.entityUuid, "{}", "{}", 4]);
		await target.service.backups!.restoreBackup(backup, async () => {});
		const state = (await target.database.query<Record<string, unknown>>("SELECT * FROM sync_state;"))[0]!;
		expect(state).toMatchObject({ device_id: old.device_id, enabled: 0, development_seeded: 0, server_url: null, server_instance_id: null, pull_cursor: null, tracking_enabled: 1 });
		expect(state.local_epoch).not.toBe(old.local_epoch);
		expect(await target.database.query("SELECT * FROM sync_conflicts;")).toEqual([]);
		expect(await target.database.query("SELECT * FROM sync_baselines;")).toEqual([]);
		const restarted = await queue.list();
		expect(new Set(restarted.map((row) => row.batchId)).size).toBe(1);
		expect(restarted.every((row) => row.status === "pending" && row.baseRevision === 0)).toBe(true);
		expect(restarted.some((row) => previous.some((oldRow) => oldRow.operationId === row.operationId))).toBe(false);
		expect(await queue.acknowledgeBatch(previous[0]!.batchId, previous.map((row) => ({ operationId: row.operationId, serverRevision: 1 })))).toBe(false);
	});

	it("rolls back identities, server state and pending operations together with the fach data", async () => {
		await populate(target);
		const queue = createSyncQueue(target.database);
		const previous = await target.service.backups!.exportBackup();
		const operations = await queue.list(); const state = await target.database.query("SELECT * FROM sync_state;");
		const run = target.driver.run;
		const spy = vi.spyOn(target.driver, "run").mockImplementation(async (statement, values) => {
			if (statement.startsWith("INSERT INTO recipes")) throw new Error("write failed");
			return run(statement, values);
		});
		await expect(target.service.backups!.restoreBackup(backup, async () => {})).rejects.toThrow("write failed"); spy.mockRestore();
		const restored = await target.service.backups!.exportBackup();
		expect({ ...restored, exportedAt: previous.exportedAt }).toEqual(previous);
		expect(await queue.list()).toEqual(operations);
		expect(await target.database.query("SELECT * FROM sync_state;")).toEqual(state);
	});

	it.each(["missing identity", "wrong local ID", "duplicate UUID", "invalid UUID", "overlapping tombstone", "unresolved aggregate"])("rejects %s before the safety writer or any SQL mutation", async (failure) => {
		const bad = structuredClone(backup);
		if (bad.version === 1) throw new Error("expected identities");
		if (failure === "missing identity") bad.identities.pop();
		if (failure === "wrong local ID") bad.identities[0]!.localId = 9999;
		if (failure === "duplicate UUID") bad.identities[1]!.uuid = bad.identities[0]!.uuid;
		if (failure === "invalid UUID") bad.identities[0]!.uuid = "not-a-uuid";
		if (failure === "overlapping tombstone") bad.tombstones.push({ entity: "profiles", uuid: bad.identities[0]!.uuid, aggregateEntity: "profiles", aggregateUuid: bad.identities[0]!.uuid, deletedAt: bad.exportedAt });
		if (failure === "unresolved aggregate") bad.tombstones.push({ entity: "recipe_ingredients", uuid: createUuid(), aggregateEntity: "recipes", aggregateUuid: createUuid(), deletedAt: bad.exportedAt });
		const writer = vi.fn(async () => {});
		await expect(target.service.backups!.restoreBackup(bad, writer)).rejects.toBeDefined();
		expect(writer).not.toHaveBeenCalled();
		expect(await target.service.profiles.listProfiles()).toEqual([]);
		expect(await createSyncQueue(target.database).list()).toEqual([]);
	});

	it("refuses export/restore if unknown newer schema metadata is present", async () => {
		await target.database.run("INSERT INTO schema_migrations (version, name) VALUES (99, 'future');");
		await expect(target.service.backups!.exportBackup()).rejects.toMatchObject({ code: "backupFormat" });
		await expect(target.service.backups!.restoreBackup(backup, async () => {})).rejects.toMatchObject({ code: "backupFormat" });
	});
});
