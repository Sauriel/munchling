import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { createSqlDatabase } from "../../app/utils/database/executor";
import { runLocalMigrations } from "../../app/utils/database/migrations";
import { applyRemoteTransaction, createSyncQueue } from "../../app/utils/database/outbox";
import { isUuid } from "../../shared/domain/sync";
import { parseBackupJson, type MunchlingBackup } from "../../shared/domain/backup";

const foodInput = { nameDe: "Nudeln", nameEn: "Pasta", caloriesPer100g: 200, fatPer100g: 2, carbsPer100g: 30, sugarPer100g: 3, fiberPer100g: 4, proteinPer100g: 10, saltPer100g: 0.5 };
type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
const opened: TestDb[] = [];
async function open(options: Parameters<typeof createTestDatabase>[0] = {}) { const test = await createTestDatabase(options); opened.push(test); return test; }
afterEach(() => { for (const test of opened.splice(0)) test.close(); });
async function populate(test: TestDb) {
	const profile = (await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 2000 }))!;
	const legacy = !(await test.database.query<{ name: string }>("PRAGMA table_info(foods);")).some(c => c.name === "portion_size_grams");
	if (legacy) {
		await test.database.run("INSERT INTO foods(name_de,name_en,calories_per_100g,fat_per_100g,carbs_per_100g,sugar_per_100g,fiber_per_100g,protein_per_100g,salt_per_100g,is_custom) VALUES ('Nudeln','Pasta',200,2,30,3,4,10,0.5,1);");
		await test.database.run("INSERT INTO recipes(name_de,name_en) VALUES ('Gericht','Dish');");
		await test.database.run("INSERT INTO recipe_ingredients(recipe_id,food_id,amount_grams) VALUES (1,1,150);");
	}
	const food = legacy ? (await test.service.foods.getFoodById(1))! : (await test.service.foods.createFood(foodInput))!;
	const recipe = legacy ? (await test.service.recipes.getRecipeById(1))! : (await test.service.recipes.createRecipe({ nameDe: "Gericht", nameEn: "Dish", ingredients: [{ foodId: food.id, amountGrams: 150 }] }))!;
	const meal = (await test.service.mealLogs.createMealLog({ loggedAt: "2026-10-05 12:00:00", recipeId: recipe.id, profiles: [{ profileId: profile.id, portionGrams: 100.125 }] }))!;
	return { profile, food, recipe, meal };
}
const hasUuid = async (test: TestDb) => (await test.database.query<{ name: string }>("PRAGMA table_info(profiles);")).some((column) => column.name === "uuid");
const migrate = (test: TestDb, save: (backup: MunchlingBackup) => Promise<void> = vi.fn(async () => {})) => runLocalMigrations(createSqlDatabase(test.driver), save);

describe("safe schema v2 migration", () => {
	it("preserves populated v1 data and builds globally identified complete aggregates", async () => {
		const test = await open({ version: 1 });
		await populate(test);
		const previous = await test.service.backups!.exportBackup();
		// The safety writer must not query the queued facade while its lock is
		// held. This inspection uses the raw driver only in this test.
		const save = vi.fn(async (backup: MunchlingBackup) => {
			expect(backup.data).toEqual(previous.data);
			expect(backup.version).toBe(1);
			expect((await test.driver.query<{ name: string }>("PRAGMA table_info(profiles);")).some((row) => row.name === "uuid")).toBe(false);
		});
		await migrate(test, save);
		const backup = parseBackupJson(JSON.stringify(await test.service.backups!.exportBackup()));
		expect(backup.data).toEqual(previous.data);
		expect(backup.version).toBe(4);
		if (backup.version === 1) throw new Error("expected identities");
		expect(backup.identities).toHaveLength(6);
		expect(backup.identities.every((identity) => isUuid(identity.uuid))).toBe(true);
		expect(new Set(backup.identities.map((identity) => identity.uuid)).size).toBe(6);
		const operations = await createSyncQueue(test.database).list();
		expect(operations.map((op) => op.entity).sort()).toEqual(["foods", "meal_logs", "profiles", "recipes"]);
		expect(new Set(operations.map((op) => op.batchId)).size).toBe(1);
		expect(save).toHaveBeenCalledTimes(1);
		const again = vi.fn(async () => {});
		await migrate(test, again);
		expect(again).not.toHaveBeenCalled();
		expect((await test.service.backups!.exportBackup()).data).toEqual(previous.data);
		expect(await createSyncQueue(test.database).list()).toEqual(operations);
	});

	it("leaves schema and all rows unchanged when the independent safety writer fails", async () => {
		const test = await open({ version: 1 }); await populate(test);
		const old = await test.service.backups!.exportBackup();
		await expect(migrate(test, vi.fn(async () => { throw new Error("disk full"); }))).rejects.toThrow("disk full");
		expect(await hasUuid(test)).toBe(false);
		expect((await test.service.backups!.exportBackup()).data).toEqual(old.data);
		expect(await test.database.query("SELECT version FROM schema_migrations;")).toEqual([{ version: 1 }]);
	});

	it.each(["DDL", "version marker", "outbox"])("rolls back DDL, UUIDs and rows after a failed %s, then safely retries", async (failure) => {
		const test = await open({ version: 1 }); await populate(test);
		const previous = await test.service.backups!.exportBackup();
		const run = test.driver.run;
		const execute = test.driver.execute;
		const spy = failure === "DDL"
			? vi.spyOn(test.driver, "execute").mockImplementation((statements, transaction) => execute(statements.includes("CREATE TABLE sync_state") ? `${statements}\nINSERT INTO migration_interrupted VALUES(1);` : statements, transaction))
			: vi.spyOn(test.driver, "run").mockImplementation(async (statement, values) => {
				if (statement.startsWith(failure === "outbox" ? "INSERT INTO sync_outbox" : "INSERT INTO schema_migrations")) throw new Error("interrupted");
				return run(statement, values);
			});
		await expect(migrate(test)).rejects.toThrow("interrupted");
		spy.mockRestore();
		expect(await hasUuid(test)).toBe(false);
		expect(await test.database.query("SELECT name FROM sqlite_master WHERE name LIKE 'sync_%';")).toEqual([]);
		expect((await test.service.backups!.exportBackup()).data).toEqual(previous.data);
		await migrate(test);
		const reloaded = await open({ bytes: test.exportBytes() });
		expect((await reloaded.service.backups!.exportBackup()).data).toEqual(previous.data);
		expect(await createSyncQueue(reloaded.database).list()).toEqual(await createSyncQueue(test.database).list());
	});

	it("initializes an empty install without an unnecessary safety file", async () => {
		const test = await open({ version: 0 }); const save = vi.fn(async () => {});
		await migrate(test, save);
		expect(save).not.toHaveBeenCalled();
		expect(await hasUuid(test)).toBe(true);
		expect(await createSyncQueue(test.database).list()).toEqual([]);
		expect(await test.database.query("SELECT enabled,tracking_enabled FROM sync_state;")).toEqual([{ enabled: 0, tracking_enabled: 1 }]);
	});

	it("rejects a future database before modifying its fach schema", async () => {
		const test = await open({ version: 1 });
		await test.database.run("INSERT INTO schema_migrations (version,name) VALUES (99,'future');");
		await expect(migrate(test)).rejects.toThrow("newer");
		expect(await hasUuid(test)).toBe(false);
	});
});

describe("transactional aggregate outbox", () => {
	it("captures one complete recipe operation and UUID references, not partial ingredient writes", async () => {
		const test = await open(); const food = (await test.service.foods.createFood(foodInput))!;
		const queue = createSyncQueue(test.database); const before = (await queue.list()).length;
		await test.service.recipes.createRecipe({ nameDe: "A", nameEn: "A", ingredients: [{ foodId: food.id, amountGrams: 12 }, { foodId: food.id, amountGrams: 13 }] });
		const added = (await queue.list()).slice(before);
		expect(added).toHaveLength(1);
		expect(added[0]).toMatchObject({ entity: "recipes", operation: "upsert", baseRevision: 0, status: "pending" });
		const ingredients = added[0]!.payload.ingredients as Record<string, unknown>[];
		expect(ingredients).toHaveLength(2);
		expect(ingredients.map((row) => row.amount_grams)).toEqual([12, 13]);
		expect(ingredients.every((row) => isUuid(row.id) && isUuid(row.food_id) && row.recipe_id === added[0]!.entityUuid)).toBe(true);
		expect(await test.database.query("SELECT * FROM sync_dirty;")).toEqual([]);
		expect(await test.database.query("SELECT enabled FROM sync_state;")).toEqual([{ enabled: 0 }]);
	});

	it("tracks food deletion, affected recipe ingredients and cascading meals in the same batch", async () => {
		const test = await open(); const { food, profile } = await populate(test);
		await test.service.mealLogs.createMealLog({ loggedAt: "2026-10-05 13:00:00", foodId: food.id, profiles: [{ profileId: profile.id, portionGrams: 20 }] });
		const queue = createSyncQueue(test.database); const count = (await queue.list()).length;
		await test.service.foods.deleteFood(food.id);
		const changes = (await queue.list()).slice(count);
		expect(changes.map((op) => `${op.entity}:${op.operation}`).sort()).toEqual(["foods:delete", "meal_logs:delete", "recipes:upsert"]);
		expect(new Set(changes.map((op) => op.batchId)).size).toBe(1);
		expect(changes.find((op) => op.entity === "recipes")!.payload.ingredients).toEqual([]);
		const backup = parseBackupJson(JSON.stringify(await test.service.backups!.exportBackup()));
		if (backup.version === 1) throw new Error("expected identities");
		expect(backup.tombstones.map((row) => row.entity).sort()).toEqual(["foods", "meal_log_profiles", "meal_logs", "recipe_ingredients"]);
	});

	it("tracks deleted sub-recipes, their ingredients, dependent recipes and meals", async () => {
		const test = await open(); const { recipe } = await populate(test);
		await test.service.recipes.createRecipe({ nameDe: "Parent", nameEn: "Parent", ingredients: [{ subRecipeId: recipe.id, amountGrams: 10 }] });
		const queue = createSyncQueue(test.database); const count = (await queue.list()).length;
		await test.service.recipes.deleteRecipe(recipe.id);
		const changes = (await queue.list()).slice(count);
		expect(changes.map((row) => `${row.entity}:${row.operation}`).sort()).toEqual(["meal_logs:delete", "recipes:delete", "recipes:upsert"]);
		expect(changes.find((row) => row.operation === "upsert")!.payload.ingredients).toEqual([]);
		expect(new Set(changes.map((row) => row.batchId)).size).toBe(1);
	});

	it("tracks profile cascade as a complete changed meal with empty portions", async () => {
		const test = await open(); const { profile } = await populate(test);
		const queue = createSyncQueue(test.database); const count = (await queue.list()).length;
		await test.service.profiles.deleteProfile(profile.id);
		const changes = (await queue.list()).slice(count);
		expect(changes.map((row) => `${row.entity}:${row.operation}`).sort()).toEqual(["meal_logs:upsert", "profiles:delete"]);
		expect(changes.find((row) => row.entity === "meal_logs")!.payload.profiles).toEqual([]);
	});

	it("prevents seeded development installations from enabling sync", async () => {
		const test = await open();
		await test.database.run("UPDATE sync_state SET development_seeded=1 WHERE id=1;");
		await expect(test.database.run("UPDATE sync_state SET enabled=1 WHERE id=1;")).rejects.toThrow("CHECK");
		expect(await test.database.query("SELECT enabled,development_seeded FROM sync_state;")).toEqual([{ enabled: 0, development_seeded: 1 }]);
	});

	it("tracks standalone statements and rejects identity changes", async () => {
		const test = await open(); await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 1 });
		await test.database.run("UPDATE profiles SET name='B' WHERE id=1;");
		expect((await createSyncQueue(test.database).list()).map((row) => row.payload.name)).toEqual(["A", "B"]);
		await expect(test.database.run("UPDATE profiles SET uuid=NULL WHERE id=1;")).rejects.toThrow("immutable");
		expect(await test.database.query("SELECT COUNT(*) AS n FROM sync_records;")).toEqual([{ n: 1 }]);
	});

	it("rolls back business rows and identities if outbox insertion fails", async () => {
		const test = await open(); const run = test.driver.run;
		const spy = vi.spyOn(test.driver, "run").mockImplementation(async (statement, values) => {
			if (statement.startsWith("INSERT INTO sync_outbox")) throw new Error("queue full");
			return run(statement, values);
		});
		await expect(test.service.foods.createFood(foodInput)).rejects.toThrow("queue full"); spy.mockRestore();
		expect(await test.service.foods.listFoods()).toEqual([]);
		expect(await test.database.query("SELECT * FROM sync_records;")).toEqual([]);
		expect(await test.database.query("SELECT * FROM sync_dirty;")).toEqual([]);
		expect(await createSyncQueue(test.database).list()).toEqual([]);
		expect((await test.service.foods.createFood(foodInput))!.id).toBe(1);
	});

	it("keeps the committed fach row and outbox together when persistence fails after commit", async () => {
		const test = await open(); test.persist.mockRejectedValueOnce(new Error("store failed"));
		await expect(test.service.foods.createFood(foodInput)).rejects.toThrow("store failed");
		expect(await test.service.foods.listFoods()).toHaveLength(1);
		expect(await createSyncQueue(test.database).list()).toHaveLength(1);
	});

	it("applies remote changes without echoes, and restores tracking after rollback", async () => {
		const test = await open(); await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 1 });
		const queue = createSyncQueue(test.database); const previous = await queue.list();
		await applyRemoteTransaction(test.database, async (sql) => { await sql.run("UPDATE profiles SET name='Remote' WHERE id=1;"); });
		expect(await queue.list()).toEqual(previous);
		await expect(applyRemoteTransaction(test.database, async (sql) => { await sql.run("DELETE FROM profiles WHERE id=1;"); throw new Error("pull failed"); })).rejects.toThrow("pull failed");
		expect((await test.service.profiles.listProfiles())[0]!.name).toBe("Remote");
		expect(await test.database.query("SELECT tracking_enabled FROM sync_state;")).toEqual([{ tracking_enabled: 1 }]);
		await test.service.profiles.updateProfile(1, { name: "Local" });
		expect(await queue.list()).toHaveLength(previous.length + 1);
	});

	it("does not silently rebase a pending edit onto a later remote version", async () => {
		const test = await open(); await test.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 1 });
		const queue = createSyncQueue(test.database);
		// Simulate an observed remote revision. A real pull must first store a
		// conflict; even an incorrectly advanced registry must not rebase us.
		await test.database.run("UPDATE sync_records SET server_revision=5;");
		const batch = await queue.claimNextBatch();
		expect(batch[0]!.baseRevision).toBe(0);
		await expect(queue.acknowledgeBatch(batch[0]!.batchId, [{ operationId: batch[0]!.operationId, serverRevision: 1 }])).rejects.toThrow("outdated");
		expect(await queue.claimNextBatch()).toEqual(batch);
		expect(await test.database.query("SELECT server_revision FROM sync_records;")).toEqual([{ server_revision: 5 }]);
	});

	it("requires complete unique receipts for multi-aggregate batches before advancing", async () => {
		const test = await open({ version: 1 }); await populate(test); await migrate(test);
		const queue = createSyncQueue(test.database); const batch = await queue.claimNextBatch();
		const receipts = batch.map((row) => ({ operationId: row.operationId, serverRevision: 1 }));
		await expect(queue.acknowledgeBatch(batch[0]!.batchId, receipts.slice(1))).rejects.toThrow("receipt");
		await expect(queue.acknowledgeBatch(batch[0]!.batchId, receipts.map(() => receipts[0]!))).rejects.toThrow("receipt");
		await expect(queue.acknowledgeBatch(batch[0]!.batchId, receipts.map((row) => ({ ...row, serverRevision: 0 })))).rejects.toThrow("receipt");
		expect(await test.database.query("SELECT * FROM sync_baselines;")).toEqual([]);
		expect(await queue.claimNextBatch()).toEqual(batch);
		expect(await queue.acknowledgeBatch(batch[0]!.batchId, receipts)).toBe(true);
		expect(await queue.list()).toEqual([]);
		expect(await test.database.query("SELECT COUNT(*) AS n FROM sync_baselines;")).toEqual([{ n: 4 }]);
	});

	it("resumes immutable in-flight batches after restart and bases subsequent writes on accepted revisions", async () => {
		const test = await open(); await test.service.profiles.createProfile({ name: "A", dailyCaloriesTarget: 1 });
		const queue = createSyncQueue(test.database); const first = await queue.claimNextBatch();
		expect(first[0]).toMatchObject({ baseRevision: 0, status: "inflight" });
		await test.service.profiles.updateProfile(1, { name: "B" });
		expect(await queue.claimNextBatch()).toEqual(first);
		const reloaded = await open({ bytes: test.exportBytes() }); const resumed = createSyncQueue(reloaded.database);
		expect(await resumed.claimNextBatch()).toEqual(first);
		await expect(resumed.acknowledgeBatch(first[0]!.batchId, [])).rejects.toThrow("receipt");
		expect(await resumed.claimNextBatch()).toEqual(first);
		await resumed.acknowledgeBatch(first[0]!.batchId, [{ operationId: first[0]!.operationId, serverRevision: 1 }]);
		const baseline = await reloaded.database.query<{ payload: string }>("SELECT payload FROM sync_baselines;");
		expect(JSON.parse(baseline[0]!.payload).name).toBe("A");
		const next = await resumed.claimNextBatch();
		expect(next[0]).toMatchObject({ baseRevision: 1, payload: { name: "B" } });
		expect(next[0]!.operationId).not.toBe(first[0]!.operationId);
		expect(await resumed.acknowledgeBatch(first[0]!.batchId, [{ operationId: first[0]!.operationId, serverRevision: 1 }])).toBe(false);
		expect(await resumed.claimNextBatch()).toEqual(next);
	});
});
