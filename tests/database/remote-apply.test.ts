import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver, type ReceiveContext } from "../../app/utils/sync/apply";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createUuid } from "../../shared/domain/sync";
import type { ServerAggregate } from "../../shared/domain/server";
import type { ChangePage, SnapshotIdentity, SnapshotPage } from "../../shared/domain/protocol";
const date = "2026-10-05T12:00:00.000Z", url = "https://example.org", binding = { serverInstanceId: createUuid(), serverEpoch: createUuid() };
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function open() { const db = await createTestDatabase(); opened.push(db); return db; }
afterEach(() => opened.splice(0).forEach((db) => db.close()));
function root(entity: ServerAggregate["entity"], data: Record<string, unknown>, version = 1): ServerAggregate { return { entity, id: String(data.id), version, deletedAt: null, data }; }
const profile = (name = "Remote", id = createUuid(), version = 1) => root("profiles", { id, name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: date, updated_at: null }, version);
const food = (ean: string | null = null, id = createUuid(), version = 1) => root("foods", { id, name_de: "Food", name_en: "Food", brand: null, ean, calories_per_100g: 100, fat_per_100g: 1, carbs_per_100g: 10, sugar_per_100g: 0, fiber_per_100g: 0, protein_per_100g: 10, salt_per_100g: 0, is_custom: 1, created_at: date, updated_at: null }, version);
const recipe = (foodId: string, id = createUuid(), child = createUuid(), version = 1) => root("recipes", { id, name_de: "Recipe", name_en: "Recipe", description: null, is_sub_recipe: 0, created_at: date, updated_at: null, ingredients: [{ id: child, recipe_id: id, food_id: foodId, sub_recipe_id: null, amount_grams: 100, created_at: date }] }, version);
function snapshot(roots: ServerAggregate[], cursor = "0"): SnapshotPage {
	const identities: SnapshotIdentity[] = roots.flatMap((row) => [{ uuid: row.id, entity: row.entity, aggregateUuid: row.id, version: row.version, deletedAt: row.deletedAt }, ...((row.data?.ingredients ?? row.data?.profiles ?? []) as Record<string, unknown>[]).map((child) => ({ uuid: String(child.id), entity: row.entity === "recipes" ? "recipe_ingredients" as const : "meal_log_profiles" as const, aggregateUuid: row.id, version: 1, deletedAt: null }))]);
	return { ...binding, protocolVersion: 1, snapshotId: createUuid(), cursor, expiresAt: "2099-10-05T12:00:00.000Z", page: 0, pageCount: 1, nextPage: null, aggregates: roots, identities };
}
async function initialize(db: Awaited<ReturnType<typeof open>>, roots: ServerAggregate[] = []) {
	const stage = createSnapshotStaging(db.database), localEpoch = (await stage.state()).localEpoch, receiver = createRemoteReceiver(db.database);
	await stage.begin(localEpoch, url, snapshot(roots)); const result = await receiver.adoptSnapshot(localEpoch);
	return { receiver, result, context: { ...binding, localEpoch, url, cursor: "0" } as ReceiveContext };
}
function page(roots: ServerAggregate[], from = 0): ChangePage {
	const batchId = createUuid(), changes = roots.map((aggregate, i) => ({ cursor: String(from + i + 1), aggregate }));
	return { ...binding, protocolVersion: 1, fromCursor: String(from), cursor: String(from + roots.length), highWaterCursor: String(from + roots.length + 10), hasMore: true, batches: [{ batchId, deviceId: createUuid(), firstCursor: String(from + 1), lastCursor: String(from + roots.length), changes }] };
}
describe("atomic conflict-aware SQLite receive", () => {
	it("adopts complete UUID graphs, preserves numeric IDs and timestamps, and suppresses echoes", async () => {
		const db = await open(), f = food(), p = profile(), r = recipe(f.id), mealId = createUuid();
		const meal = root("meal_logs", { id: mealId, logged_at: "2024-05-10 18:30:00", food_id: null, recipe_id: r.id, total_weight_grams: 100, created_at: date, updated_at: null, profiles: [{ id: createUuid(), meal_log_id: mealId, profile_id: p.id, portion_factor: 1, created_at: date }] });
		const { receiver, result, context } = await initialize(db, [meal, r, p, f]); expect(result.status).toBe("applied");
		expect(await createSyncQueue(db.database).list()).toEqual([]); expect(await db.database.query("SELECT logged_at FROM meal_logs;")).toEqual([{ logged_at: "2024-05-10 18:30:00" }]);
		const oldId = (await db.service.profiles.listProfiles())[0]!.id; const changes = page([profile("Updated", p.id, 2)]); await receiver.applyPage(context, changes);
		expect((await db.service.profiles.listProfiles())[0]).toMatchObject({ id: oldId, name: "Updated" }); expect((await createSnapshotStaging(db.database).state()).cursor).toBe("1"); expect(await createSyncQueue(db.database).list()).toEqual([]);
		expect(await receiver.applyPage(context, changes)).toEqual([]); expect(await db.database.query("SELECT * FROM sync_dirty")).toEqual([]);
	});
	it("retains pending/in-flight batches exactly, persists conflicts and consumes only complete groups", async () => {
		const db = await open(), p = profile(), { receiver, context } = await initialize(db, [p]); const id = (await db.service.profiles.listProfiles())[0]!.id;
		await db.service.profiles.updateProfile(id, { name: "Local edit" }); const queue = createSyncQueue(db.database), batch = await queue.claimNextBatch(), before = await queue.list();
		const response = page([profile("Server edit", p.id, 2), food()]); const result = await receiver.applyPage(context, response);
		expect(result[0]).toMatchObject({ status: "blocked", reason: "localChanges" }); expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Local edit"); expect(await db.service.foods.listFoods()).toEqual([]); expect(await queue.list()).toEqual(before); expect(await queue.claimNextBatch()).toEqual(batch);
		expect((await receiver.conflicts()).find((row) => row.uuid === p.id)).toMatchObject({ server_revision: 2 }); expect((await createSnapshotStaging(db.database).state()).cursor).toBe("2");
		const reopened = await createTestDatabase({ bytes: db.exportBytes() }); opened.push(reopened); expect((await createRemoteReceiver(reopened.database).conflicts())).toHaveLength(2); expect(await createSyncQueue(reopened.database).list()).toEqual(before);
	});
	it("blocks cascading deletion that would erase a local-only dependent", async () => {
		const db = await open(), f = food(), { receiver, context } = await initialize(db, [f]); const id = (await db.service.foods.listFoods())[0]!.id;
		await db.service.recipes.createRecipe({ nameDe: "Local", nameEn: "Local", ingredients: [{ foodId: id, amountGrams: 25 }] }); const queue = await createSyncQueue(db.database).list();
		const result = await receiver.applyPage(context, page([{ ...f, version: 2, data: null, deletedAt: date }]));
		expect(result[0]).toMatchObject({ status: "blocked", reason: "localDependency" }); expect(await db.service.recipes.listRecipes()).toHaveLength(1); expect(await db.service.foods.listFoods()).toHaveLength(1); expect(await createSyncQueue(db.database).list()).toEqual(queue);
	});
	it("handles replacement plus guarded cascades without foreign-key failures or emitted outbox changes", async () => {
		const db = await open(), f = food(), r = recipe(f.id), { receiver, context } = await initialize(db, [f, r]);
		const updated = { ...r, version: 2, data: { ...r.data!, ingredients: [] } }; const deleted = { ...f, version: 2, data: null, deletedAt: date };
		expect((await receiver.applyPage(context, page([deleted, updated])))[0]!.status).toBe("applied"); expect(await db.service.foods.listFoods()).toEqual([]); expect(await db.database.query("SELECT id FROM recipe_ingredients;")).toEqual([]); expect(await createSyncQueue(db.database).list()).toEqual([]);
	});
	it("supports EAN swaps; a collision with a local-only food blocks the entire group", async () => {
		const db = await open(), f1 = food("A"), f2 = food("B"), { receiver, context } = await initialize(db, [f1, f2]);
		expect((await receiver.applyPage(context, page([food("B", f1.id, 2), food("A", f2.id, 2)])))[0]!.status).toBe("applied");
		await db.service.foods.createFood({ nameDe: "Local", nameEn: "Local", ean: "C", caloriesPer100g: 50, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 });
		expect((await receiver.applyPage({ ...context, cursor: "2" }, page([food("C", f1.id, 3)], 2)))[0]!.reason).toBe("eanConflict"); expect(await db.database.query("SELECT ean FROM foods WHERE uuid=?;", [f1.id])).toEqual([{ ean: "B" }]);
	});
	it("rolls back both rows and cursor if SQL fails late in an otherwise valid aggregate", async () => {
		const db = await open(), f = food(), { receiver, context } = await initialize(db, [f]);
		await db.database.execute("CREATE TRIGGER fail_remote_ingredient BEFORE INSERT ON recipe_ingredients BEGIN SELECT RAISE(ABORT,'injected'); END;");
		await expect(receiver.applyPage(context, page([recipe(f.id)]))).rejects.toThrow("injected"); expect(await db.service.recipes.listRecipes()).toEqual([]); expect((await createSnapshotStaging(db.database).state()).cursor).toBe("0"); expect(await db.database.query("SELECT * FROM sync_inbox WHERE id LIKE 'batch:%';")).toEqual([]); expect((await db.database.query<{ tracking_enabled: number }>("SELECT tracking_enabled FROM sync_state"))[0]!.tracking_enabled).toBe(1);
	});
	it("does not rebase a newer local edit when replaying an acknowledged predecessor", async () => {
		const db = await open(), p = profile(), { receiver, context } = await initialize(db, [p]); const id = (await db.service.profiles.listProfiles())[0]!.id;
		await db.service.profiles.updateProfile(id, { name: "Accepted local" }); const queue = createSyncQueue(db.database), batch = await queue.claimNextBatch();
		await queue.acknowledgeBatch(batch[0]!.batchId, batch.map((op) => ({ operationId: op.operationId, serverRevision: 2 })));
		await db.service.profiles.updateProfile(id, { name: "Newer pending" }); const pending = await queue.list();
		expect((await receiver.applyPage(context, page([profile("Accepted local", p.id, 2)])))[0]!.status).toBe("applied");
		expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Newer pending"); expect(await queue.list()).toEqual(pending); expect(await receiver.conflicts()).toEqual([]);
	});
	it("preserves numeric IDs through server deletion and subsequent resurrection", async () => {
		const db = await open(), p = profile(), { receiver, context } = await initialize(db, [p]); const id = (await db.service.profiles.listProfiles())[0]!.id;
		await receiver.applyPage(context, page([{ ...p, version: 2, deletedAt: date, data: null }]));
		await receiver.applyPage({ ...context, cursor: "1" }, page([profile("Restored", p.id, 3)], 1));
		expect((await db.service.profiles.listProfiles())[0]).toMatchObject({ id, name: "Restored" }); expect(await createSyncQueue(db.database).list()).toEqual([]);
	});
	it("blocks a cycle created only by combining server changes with a local dependency edit", async () => {
		const db = await open(), aId = createUuid(), bId = createUuid();
		const a = { ...recipe(createUuid(), aId), data: { ...recipe(createUuid(), aId).data!, ingredients: [] } }, b = { ...recipe(createUuid(), bId), data: { ...recipe(createUuid(), bId).data!, ingredients: [] } };
		const { receiver, context } = await initialize(db, [a, b]); const locals = await db.database.query<{ uuid: string; id: number }>("SELECT uuid,id FROM recipes;");
		await db.service.recipes.updateRecipe(locals.find(row => row.uuid === bId)!.id, { ingredients: [{ subRecipeId: locals.find(row => row.uuid === aId)!.id, amountGrams: 100 }] });
		const remote = { ...a, version: 2, data: { ...a.data!, ingredients: [{ id: createUuid(), recipe_id: aId, food_id: null, sub_recipe_id: bId, amount_grams: 100, created_at: date }] } };
		expect((await receiver.applyPage(context, page([remote])))[0]!.reason).toBe("recipeCycle");
	});
	it("refuses a foreign UUID owner, dangling reference, binding switch, stale local epoch and non-contiguous cursor", async () => {
		const db = await open(), f = food(), r = recipe(f.id), { receiver, context } = await initialize(db, [f, r]); const other = recipe(f.id, createUuid(), String((r.data!.ingredients as Record<string, unknown>[])[0]!.id));
		expect((await receiver.applyPage(context, page([other])))[0]!.reason).toBe("identityConflict");
		await expect(receiver.applyPage({ ...context, serverEpoch: createUuid(), cursor: "1" }, page([profile()], 1))).rejects.toThrow("serverChanged");
		await expect(receiver.applyPage({ ...context, localEpoch: createUuid(), cursor: "1" }, page([profile()], 1))).rejects.toThrow("localReset");
		expect((await receiver.applyPage({ ...context, cursor: "1" }, page([recipe(createUuid())], 1)))[0]!.reason).toBe("missingReference");
		await expect(receiver.applyPage({ ...context, cursor: "2" }, { ...page([profile()], 2), fromCursor: "1" })).rejects.toThrow("invalidResponse");
	});
});
