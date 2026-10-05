import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServerDatabase } from "../../server/database/connection";
import { readServerState } from "../../server/database/state";
import { writeServerBatch } from "../../server/services/write";
import { previewServerDeletion, readServerAggregate } from "../../server/services/storage";
import type { ServerOperation, ServerWriteBatch } from "../../shared/domain/server";
import { createUuid, type SyncAggregate } from "../../shared/domain/sync";
import { createTestDatabase } from "../helpers/sqlite";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { newDatabase, resetDatabase } from "./helpers";

const date = "2026-10-05T12:00:00.000Z";
const profile = (id = createUuid(), name = "A"): Record<string, unknown> => ({ id, name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: 5.5, created_at: date, updated_at: null });
const food = (id = createUuid(), ean: string | null = null): Record<string, unknown> => ({ id, name_de: "Nudeln 🥗", name_en: "Pasta", brand: null, ean, calories_per_100g: 200, fat_per_100g: 2, carbs_per_100g: 30, sugar_per_100g: 3, fiber_per_100g: 4, protein_per_100g: 10, salt_per_100g: 0.5, is_custom: 1, created_at: date, updated_at: null });
const recipe = (id = createUuid(), ingredients: Record<string, unknown>[] = []): Record<string, unknown> => ({ id, name_de: "Gericht", name_en: "Dish", description: null, is_sub_recipe: 0, ingredients, created_at: date, updated_at: null });
const ingredient = (parent: string, foodId: string | null, subRecipeId: string | null = null) => ({ id: createUuid(), recipe_id: parent, food_id: foodId, sub_recipe_id: subRecipeId, amount_grams: 12.125, created_at: date });
const meal = (id: string, foodId: string, profileId: string): Record<string, unknown> => ({ id, food_id: foodId, recipe_id: null, logged_at: date, total_weight_grams: 100.125, created_at: date, updated_at: null, profiles: [{ id: createUuid(), meal_log_id: id, profile_id: profileId, portion_factor: 0.625123456789, created_at: date }] });
const operation = (entity: SyncAggregate, payload: Record<string, unknown>, baseRevision = 0): ServerOperation => ({ operationId: createUuid(), entity, entityUuid: String(payload.id), baseRevision, operation: "upsert", payload });
const deletion = (entity: SyncAggregate, uuid: string, baseRevision: number): ServerOperation => ({ operationId: createUuid(), entity, entityUuid: uuid, baseRevision, operation: "delete", payload: { id: uuid, deleted_at: date } });
async function batch(database: ServerDatabase, operations: ServerOperation[], guards: ServerWriteBatch["guards"] = []): Promise<ServerWriteBatch> {
	const state = await database.withConnection((sql) => readServerState(sql));
	return { batchId: createUuid(), serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid, deviceId: createUuid(), operations, guards };
}
const countStatements = { profiles: "SELECT COUNT(*) AS n FROM profiles", write_batches: "SELECT COUNT(*) AS n FROM write_batches", change_log: "SELECT COUNT(*) AS n FROM change_log", sync_identities: "SELECT COUNT(*) AS n FROM sync_identities", recipes: "SELECT COUNT(*) AS n FROM recipes" };
const tableCount = async (database: ServerDatabase, table: keyof typeof countStatements) => (await database.withConnection((sql) => sql.query<{ n: number }>(countStatements[table])))[0]!.n;

describe("real MariaDB shared write service", () => {
	let database: ServerDatabase;
	beforeAll(() => { database = newDatabase(); });
	beforeEach(async () => { await resetDatabase(database); });
	afterAll(async () => { await database.close(); });
	async function populated() {
		const p = profile(), f = food(createUuid(), "123"), rId = createUuid(), mId = createUuid();
		const r = recipe(rId, [ingredient(rId, String(f.id))]), m = meal(mId, String(f.id), String(p.id));
		await writeServerBatch(database, await batch(database, [operation("meal_logs", m), operation("recipes", r), operation("foods", f), operation("profiles", p)]));
		return { p, f, r, m };
	}

	it("writes all six tables atomically despite reverse dependency order, preserving exact numbers and Unicode", async () => {
		const { p, f, r, m } = await populated();
		expect(await readServerAggregate(database, "profiles", String(p.id))).toMatchObject({ version: 1, data: p });
		expect(await readServerAggregate(database, "foods", String(f.id))).toMatchObject({ version: 1, data: f });
		expect(await readServerAggregate(database, "recipes", String(r.id))).toMatchObject({ version: 1, data: r });
		expect(await readServerAggregate(database, "meal_logs", String(m.id))).toMatchObject({ version: 1, data: m });
		expect(await tableCount(database, "sync_identities")).toBe(6);
		const changes = await database.withConnection((sql) => sql.query<{ payload: string }>("SELECT payload FROM change_log ORDER BY change_cursor"));
		expect(changes.some((row) => row.payload.includes("🥗"))).toBe(true);
	});

	it.each(["2026-10-05 12:34:56", "2026-10-05T12:34", "2026-10-05T12:34:56+02:00", "0001-01-01T00:00"])("preserves the literal historical meal timestamp %s without inventing a timezone", async (loggedAt) => {
		const { m } = await populated();
		await writeServerBatch(database, await batch(database, [operation("meal_logs", { ...m, logged_at: loggedAt }, 1)]));
		expect((await readServerAggregate(database, "meal_logs", String(m.id)))!.data!.logged_at).toBe(loggedAt);
	});

	it("replays a committed request with the original receipt, without extra writes or cursors", async () => {
		const request = await batch(database, [operation("profiles", profile())]);
		const receipt = await writeServerBatch(database, request);
		expect(await writeServerBatch(database, structuredClone(request))).toEqual(receipt);
		expect(await tableCount(database, "profiles")).toBe(1);
		expect(await tableCount(database, "change_log")).toBe(1);
		expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(1);
	});

	it("rejects changed requests or operation IDs reused in another batch", async () => {
		const request = await batch(database, [operation("profiles", profile())]);
		await writeServerBatch(database, request);
		const changed = structuredClone(request); changed.operations[0]!.payload.name = "Other";
		await expect(writeServerBatch(database, changed)).rejects.toMatchObject({ code: "idempotencyConflict" });
		const reused = { ...request, batchId: createUuid() };
		await expect(writeServerBatch(database, reused)).rejects.toMatchObject({ code: "idempotencyConflict" });
		expect(await tableCount(database, "change_log")).toBe(1);
	});

	it("allows only one concurrent editor at the same base version", async () => {
		const payload = profile(); await writeServerBatch(database, await batch(database, [operation("profiles", payload)]));
		const first = await batch(database, [operation("profiles", { ...payload, name: "B" }, 1)]);
		const second = await batch(database, [operation("profiles", { ...payload, name: "C" }, 1)]);
		const results = await Promise.allSettled([writeServerBatch(database, first), writeServerBatch(database, second)]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "versionConflict", current: [{ version: 2 }] } });
		expect((await readServerAggregate(database, "profiles", String(payload.id)))!.version).toBe(2);
		expect(await tableCount(database, "change_log")).toBe(2);
	});

	it("rolls back all changes when any target is stale", async () => {
		const payload = profile(); await writeServerBatch(database, await batch(database, [operation("profiles", payload)]));
		await expect(writeServerBatch(database, await batch(database, [operation("foods", food()), operation("profiles", { ...payload, name: "Stale" }, 0)]))).rejects.toMatchObject({ code: "versionConflict" });
		expect(await tableCount(database, "sync_identities")).toBe(1);
		expect(await tableCount(database, "change_log")).toBe(1);
	});

	it.each(["single", "multi"])("rejects a %s-recipe cycle without partial data", async (kind) => {
		const a = createUuid(), b = kind === "single" ? a : createUuid();
		const operations = [operation("recipes", recipe(a, [ingredient(a, null, b)]))];
		if (kind === "multi") operations.push(operation("recipes", recipe(b, [ingredient(b, null, a)])));
		await expect(writeServerBatch(database, await batch(database, operations))).rejects.toMatchObject({ code: "cycle" });
		expect(await tableCount(database, "recipes")).toBe(0);
		expect(await tableCount(database, "sync_identities")).toBe(0);
		expect(await tableCount(database, "write_batches")).toBe(0);
	});

	it("accepts a forward acyclic sub-recipe reference in the same batch", async () => {
		const a = createUuid(), b = createUuid();
		await writeServerBatch(database, await batch(database, [operation("recipes", recipe(a, [ingredient(a, null, b)])), operation("recipes", recipe(b))]));
		expect((await readServerAggregate(database, "recipes", a))!.data!.ingredients).toHaveLength(1);
	});

	it("prevents concurrent edits on different recipes from introducing a cycle", async () => {
		const a = createUuid(), b = createUuid();
		await writeServerBatch(database, await batch(database, [operation("recipes", recipe(a)), operation("recipes", recipe(b))]));
		const first = await batch(database, [operation("recipes", recipe(a, [ingredient(a, null, b)]), 1)]);
		const second = await batch(database, [operation("recipes", recipe(b, [ingredient(b, null, a)]), 1)]);
		const results = await Promise.allSettled([writeServerBatch(database, first), writeServerBatch(database, second)]);
		expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
		expect(results.find((row) => row.status === "rejected")).toMatchObject({ reason: { code: "cycle" } });
	});

	it("requires deletion guards for all current dependent roots", async () => {
		const { f, r, m } = await populated();
		const preview = await previewServerDeletion(database, "foods", String(f.id));
		expect(preview.dependents.map((row) => row!.id).sort()).toEqual([r.id, m.id].sort());
		await expect(writeServerBatch(database, await batch(database, [deletion("foods", String(f.id), 1)]))).rejects.toMatchObject({ code: "dependencyConflict" });
		expect((await readServerAggregate(database, "foods", String(f.id)))!.deletedAt).toBeNull();
		expect(await tableCount(database, "change_log")).toBe(4);
	});

	it("performs guarded food cascade as explicit versioned changes with relationship tombstones", async () => {
		const { f, r, m } = await populated();
		const receipt = await writeServerBatch(database, await batch(database, [deletion("foods", String(f.id), 1)], [{ entity: "recipes", entityUuid: String(r.id), baseRevision: 1 }, { entity: "meal_logs", entityUuid: String(m.id), baseRevision: 1 }]));
		expect(receipt.changes).toHaveLength(3);
		expect(await readServerAggregate(database, "recipes", String(r.id))).toMatchObject({ version: 2, data: { ingredients: [] } });
		expect(await readServerAggregate(database, "meal_logs", String(m.id))).toMatchObject({ version: 2, data: null });
		const deleted = await database.withConnection((sql) => sql.query("SELECT entity FROM sync_identities WHERE deleted_at IS NOT NULL ORDER BY entity"));
		expect(deleted.map((row) => row.entity).sort()).toEqual(["foods", "meal_log_profiles", "meal_logs", "recipe_ingredients"]);
	});

	it("rejects a deletion whose dependent recipe changed since preview", async () => {
		const { f, r, m } = await populated();
		await writeServerBatch(database, await batch(database, [operation("recipes", { ...r, name_de: "Changed" }, 1)]));
		await expect(writeServerBatch(database, await batch(database, [deletion("foods", String(f.id), 1)], [{ entity: "recipes", entityUuid: String(r.id), baseRevision: 1 }, { entity: "meal_logs", entityUuid: String(m.id), baseRevision: 1 }]))).rejects.toMatchObject({ code: "dependencyConflict" });
		expect((await readServerAggregate(database, "recipes", String(r.id)))!.data!.name_de).toBe("Changed");
	});

	it("preserves meal weight and remaining factors when deleting a profile", async () => {
		const { p, m } = await populated();
		await writeServerBatch(database, await batch(database, [deletion("profiles", String(p.id), 1)], [{ entity: "meal_logs", entityUuid: String(m.id), baseRevision: 1 }]));
		expect(await readServerAggregate(database, "meal_logs", String(m.id))).toMatchObject({ version: 2, data: { profiles: [], total_weight_grams: 100.125 } });
	});

	it("rejects stale edit-vs-delete and permits explicitly versioned resurrection", async () => {
		const payload = profile(); await writeServerBatch(database, await batch(database, [operation("profiles", payload)]));
		await writeServerBatch(database, await batch(database, [deletion("profiles", String(payload.id), 1)]));
		await expect(writeServerBatch(database, await batch(database, [operation("profiles", payload, 1)]))).rejects.toMatchObject({ code: "versionConflict", current: [{ version: 2, data: null }] });
		await writeServerBatch(database, await batch(database, [operation("profiles", payload, 2)]));
		expect(await readServerAggregate(database, "profiles", String(payload.id))).toMatchObject({ version: 3, deletedAt: null, data: payload });
	});

	it("records a never-uploaded deletion as a tombstone without inventing a fach row", async () => {
		const uuid = createUuid(); await writeServerBatch(database, await batch(database, [deletion("profiles", uuid, 0)]));
		expect(await readServerAggregate(database, "profiles", uuid)).toMatchObject({ version: 1, data: null });
		expect(await tableCount(database, "profiles")).toBe(0);
	});

	it("enforces normalized case-sensitive EAN uniqueness and permits reuse after deletion", async () => {
		const a = food(createUuid(), " AbC "); await writeServerBatch(database, await batch(database, [operation("foods", a)]));
		await expect(writeServerBatch(database, await batch(database, [operation("foods", food(createUuid(), "AbC"))]))).rejects.toMatchObject({ code: "duplicate" });
		await writeServerBatch(database, await batch(database, [operation("foods", food(createUuid(), "abc"))]));
		await writeServerBatch(database, await batch(database, [deletion("foods", String(a.id), 1), operation("foods", food(createUuid(), "AbC"))]));
		expect(await tableCount(database, "write_batches")).toBe(3);
	});

	it("supports atomic EAN swaps independent of command order", async () => {
		const a = food(createUuid(), "1"), b = food(createUuid(), "2");
		await writeServerBatch(database, await batch(database, [operation("foods", a), operation("foods", b)]));
		await writeServerBatch(database, await batch(database, [operation("foods", { ...a, ean: "2" }, 1), operation("foods", { ...b, ean: "1" }, 1)]));
		expect((await readServerAggregate(database, "foods", String(a.id)))!.data!.ean).toBe("2");
	});

	it("supports full portion replacements with swapped profiles and stable child UUIDs", async () => {
		const p = profile(), q = profile(), f = food(), m = meal(createUuid(), String(f.id), String(p.id));
		const portions = m.profiles as Record<string, unknown>[];
		portions.push({ ...portions[0]!, id: createUuid(), profile_id: q.id, portion_factor: 0.375 });
		await writeServerBatch(database, await batch(database, [operation("profiles", p), operation("profiles", q), operation("foods", f), operation("meal_logs", m)]));
		const swapped = structuredClone(m); const changed = swapped.profiles as Record<string, unknown>[];
		changed[0]!.profile_id = q.id; changed[1]!.profile_id = p.id;
		await writeServerBatch(database, await batch(database, [operation("meal_logs", swapped, 1)]));
		expect((await readServerAggregate(database, "meal_logs", String(m.id)))!.data!.profiles).toEqual(changed);
	});

	it("rejects UUID reuse between entity types and between child owners", async () => {
		const { p, f, r } = await populated();
		await expect(writeServerBatch(database, await batch(database, [operation("foods", food(String(p.id)))]))).rejects.toMatchObject({ code: "identityConflict" });
		const other = createUuid(); const child = { ...(r.ingredients as Record<string, unknown>[])[0]!, recipe_id: other };
		await expect(writeServerBatch(database, await batch(database, [operation("recipes", recipe(other, [child]))]))).rejects.toMatchObject({ code: "identityConflict" });
		expect(await tableCount(database, "recipes")).toBe(1);
		expect((await readServerAggregate(database, "foods", String(f.id)))!.version).toBe(1);
	});

	it("turns references to remotely deleted data into a dependency conflict", async () => {
		const f = food(); await writeServerBatch(database, await batch(database, [operation("foods", f)]));
		await writeServerBatch(database, await batch(database, [deletion("foods", String(f.id), 1)]));
		const r = createUuid();
		await expect(writeServerBatch(database, await batch(database, [operation("recipes", recipe(r, [ingredient(r, String(f.id))]))]))).rejects.toMatchObject({ code: "dependencyConflict", current: [{ data: null }] });
	});

	it.each(["invalid UUID", "negative nutrient", "nonfinite goal", "unknown reference", "duplicate portion"])("rejects %s without changing cursor/data", async (kind) => {
		const p = profile(), f = food(); let operations = [operation("profiles", p), operation("foods", f)];
		if (kind === "invalid UUID") operations[0]!.operationId = "bad";
		if (kind === "negative nutrient") f.fat_per_100g = -1;
		if (kind === "nonfinite goal") p.daily_protein_target = Infinity;
		if (kind === "unknown reference") { const id = createUuid(); operations.push(operation("recipes", recipe(id, [ingredient(id, createUuid())]))); }
		if (kind === "duplicate portion") { const m = meal(createUuid(), String(f.id), String(p.id)); (m.profiles as Record<string, unknown>[]).push({ ...(m.profiles as Record<string, unknown>[])[0]!, id: createUuid() }); operations.push(operation("meal_logs", m)); }
		await expect(writeServerBatch(database, await batch(database, operations))).rejects.toBeDefined();
		expect(await tableCount(database, "sync_identities")).toBe(0);
		expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(0);
	});

	it("rejects undeclared fields before allocating identities or receipts", async () => {
		const request = await batch(database, [operation("profiles", profile())]);
		await expect(writeServerBatch(database, { ...request, undeclared: { nested: "ignored?" } })).rejects.toMatchObject({ code: "invalidType" });
		const changed = structuredClone(request); changed.operations[0]!.payload.undeclared = "ignored?";
		await expect(writeServerBatch(database, changed)).rejects.toMatchObject({ code: "invalidType" });
		expect(await tableCount(database, "sync_identities")).toBe(0);
	});

	it("binds values safely instead of executing payload text as SQL", async () => {
		const p = profile(createUuid(), "Robert'); DROP TABLE profiles; -- 🥗");
		await writeServerBatch(database, await batch(database, [operation("profiles", p)]));
		expect((await readServerAggregate(database, "profiles", String(p.id)))!.data!.name).toBe(p.name);
		expect(await tableCount(database, "profiles")).toBe(1);
	});

	it("rejects changed server identity/epoch even on a replay", async () => {
		const request = await batch(database, [operation("profiles", profile())]); await writeServerBatch(database, request);
		await database.withConnection((sql) => sql.write("UPDATE server_state SET epoch_uuid=? WHERE id=1", [createUuid()]));
		await expect(writeServerBatch(database, request)).rejects.toMatchObject({ code: "serverChanged" });
		expect(await tableCount(database, "change_log")).toBe(1);
	});

	it("rolls back fach rows, versions, receipts and cursor on a late change-log failure", async () => {
		const failing: ServerDatabase = { ...database, transaction: (work) => database.transaction((sql) => work({ ...sql, write: async (statement, values) => { if (statement.startsWith("INSERT INTO change_log")) throw new Error("private SQL failure secret"); await sql.write(statement, values); } })) };
		await expect(writeServerBatch(failing, await batch(database, [operation("profiles", profile())]))).rejects.toMatchObject({ code: "DB_WRITE_FAILED", message: "Server write could not be committed." });
		for (const table of ["profiles", "sync_identities", "write_batches", "change_log"] as const) expect(await tableCount(database, table)).toBe(0);
		expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(0);
	});

	it("publishes cursors in commit order and never exposes an uncommitted batch", async () => {
		let release!: () => void, entered!: () => void;
		const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { entered = resolve; });
		const delayed: ServerDatabase = { ...database, transaction: (work) => database.transaction(async (sql) => { const result = await work(sql); entered(); await gate; return result; }) };
		const first = writeServerBatch(delayed, await batch(database, [operation("profiles", profile())])); await started;
		let secondFinished = false; const second = writeServerBatch(database, await batch(database, [operation("profiles", profile())])).then((receipt) => { secondFinished = true; return receipt; });
		try {
			await new Promise((resolve) => setTimeout(resolve, 100)); expect(secondFinished).toBe(false);
			expect(await tableCount(database, "change_log")).toBe(0);
			expect((await database.withConnection((sql) => readServerState(sql))).last_cursor).toBe(0);
		} finally { release(); }
		const [a, b] = await Promise.all([first, second]); expect(a.cursor).toBe("1"); expect(b.cursor).toBe("2");
		expect(await database.withConnection((sql) => sql.query("SELECT change_cursor FROM change_log ORDER BY change_cursor"))).toEqual([{ change_cursor: 1 }, { change_cursor: 2 }]);
	});

	it("accepts actual native SQLite outbox batches and advances later edit bases after receipt", async () => {
		const local = await createTestDatabase();
		try {
			const p = (await local.service.profiles.createProfile({ name: "Native", dailyCaloriesTarget: 2000 }))!;
			const f = (await local.service.foods.createFood({ nameDe: "Nudeln", nameEn: "Pasta", caloriesPer100g: 200, fatPer100g: 2, carbsPer100g: 30, sugarPer100g: 3, fiberPer100g: 4, proteinPer100g: 10, saltPer100g: 0.5 }))!;
			await local.service.recipes.createRecipe({ nameDe: "A", nameEn: "A", ingredients: [{ foodId: f.id, amountGrams: 10 }] });
			await local.service.mealLogs.createMealLog({ foodId: f.id, profiles: [{ profileId: p.id, portionGrams: 15 }] });
			await local.service.profiles.updateProfile(p.id, { name: "Edited" });
			const queue = createSyncQueue(local.database);
			while ((await queue.list()).length) {
				const operations = await queue.claimNextBatch();
				const request = await batch(database, operations.map(({ operationId, entity, entityUuid, baseRevision, operation, payload }) => ({ operationId, entity, entityUuid, baseRevision, operation, payload })));
				request.batchId = operations[0]!.batchId;
				const receipt = await writeServerBatch(database, request);
				await queue.acknowledgeBatch(receipt.batchId, receipt.operations);
			}
			const profileUuid = (await local.database.query<{ uuid: string }>("SELECT uuid FROM profiles WHERE id=?", [p.id]))[0]!.uuid;
			expect(await readServerAggregate(database, "profiles", profileUuid)).toMatchObject({ version: 2, data: { name: "Edited" } });
			await local.service.foods.deleteFood(f.id);
			const operations = await queue.claimNextBatch();
			const request = await batch(database, operations.map(({ operationId, entity, entityUuid, baseRevision, operation, payload }) => ({ operationId, entity, entityUuid, baseRevision, operation, payload })));
			request.batchId = operations[0]!.batchId;
			const receipt = await writeServerBatch(database, request); await queue.acknowledgeBatch(receipt.batchId, receipt.operations);
			expect(receipt.changes.map((row) => row.entity).sort()).toEqual(["foods", "meal_logs", "recipes"]);
			expect(await queue.list()).toEqual([]);
		} finally { local.close(); }
	});
});
