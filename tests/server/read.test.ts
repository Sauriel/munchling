import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ServerDatabase } from "../../server/database/connection";
import { rotateServerEpoch } from "../../server/database/epoch";
import { readServerState } from "../../server/database/state";
import { serverMigrations } from "../../server/database/schema";
import { migrateServerDatabase } from "../../server/database/migrations";
import { createServerSnapshot, getSnapshotPage, readServerChanges, releaseServerSnapshot, serverInfo } from "../../server/services/read";
import { writeServerBatch } from "../../server/services/write";
import { createUuid } from "../../shared/domain/sync";
import type { ServerBinding } from "../../shared/domain/protocol";
import type { ServerOperation } from "../../shared/domain/server";
import { newDatabase, resetDatabase } from "./helpers";
const date = "2026-10-05T12:00:00.000Z";
const profile = (id = createUuid(), name = "A") => ({ id, name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: date, updated_at: null });
const operation = (payload: Record<string, unknown>, baseRevision = 0): ServerOperation => ({ operationId: createUuid(), entity: "profiles", entityUuid: String(payload.id), baseRevision, operation: "upsert", payload });

describe("consistent MariaDB sync downloads", () => {
	let db: ServerDatabase, binding: ServerBinding;
	beforeAll(() => { db = newDatabase(); }); afterAll(async () => { await db.close(); });
	beforeEach(async () => { await resetDatabase(db); const state = await db.withConnection(readServerState); binding = { serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid }; });
	const push = (operations: ServerOperation[]) => writeServerBatch(db, { ...binding, batchId: createUuid(), operations });
	it("upgrades v1 without changing identity, data or the initial migration checksum", async () => {
		await resetDatabase(db, false); await migrateServerDatabase(db, "munchling_test", [serverMigrations[0]!]);
		const state = await db.withConnection(readServerState); binding = { serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid };
		const p = profile(); await push([operation(p)]); await migrateServerDatabase(db, "munchling_test");
		expect((await serverInfo(db)).cursor).toBe("1"); expect((await serverInfo(db)).serverEpoch).toBe(binding.serverEpoch);
		expect((await createServerSnapshot(db, binding)).aggregates[0]!.data).toEqual(p);
	});
	it("returns a resumable empty snapshot and negotiable info", async () => {
		expect(await serverInfo(db)).toMatchObject({ protocolVersion: 1, schemaVersion: 2, cursor: "0", capabilities: { authentication: "none" } });
		const page = await createServerSnapshot(db, binding); expect(page).toMatchObject({ aggregates: [], identities: [], cursor: "0", pageCount: 1, nextPage: null });
		expect(await getSnapshotPage(db, binding, page.snapshotId, 0)).toEqual(page);
	});
	it("keeps every page at one cut despite edits/deletions/new records between downloads and a new pool", async () => {
		const a = profile(createUuid(), "a".repeat(70_000)), b = profile(createUuid(), "b".repeat(70_000)); await push([operation(a), operation(b)]);
		const first = await createServerSnapshot(db, binding, 65_536); expect(first.pageCount).toBeGreaterThan(1);
		await push([operation({ ...a, name: "Changed" }, 1), { ...operation(b, 1), operation: "delete", payload: { id: b.id } }, operation(profile())]);
		const other = newDatabase();
		try {
			const all = [first]; for (let page = 1; page < first.pageCount; page++) all.push(await getSnapshotPage(other, binding, first.snapshotId, page));
			expect(all.flatMap((page) => page.aggregates).map((row) => row.data!.name).sort()).toEqual([a.name, b.name]);
			expect(all.every((page) => page.cursor === "2")).toBe(true);
			const delta = await readServerChanges(other, binding, first.cursor); expect(delta.batches).toHaveLength(1); expect(delta.batches[0]!.changes).toHaveLength(3); expect(delta.cursor).toBe("5");
		} finally { await other.close(); }
	});
	it("uses an RR cut even when a writer commits during materialization", async () => {
		const p = profile(); await push([operation(p)]); let written = false;
		const instrumented: ServerDatabase = { ...db, transaction: (fn) => db.transaction((sql) => fn({ ...sql, query: async (statement, values) => {
			const result = await sql.query(statement, values);
			if (!written && statement.includes("SELECT id FROM sync_snapshot_lock")) { written = true; await push([operation({ ...p, name: "New" }, 1)]); }
			return result as never;
		} })) };
		const page = await createServerSnapshot(instrumented, binding); expect(page.cursor).toBe("1"); expect(page.aggregates[0]!.data!.name).toBe("A");
		expect((await readServerChanges(db, binding, page.cursor)).batches[0]!.changes[0]!.aggregate.data!.name).toBe("New");
	});
	it("retains root tombstones and all identities in snapshots", async () => {
		const p = profile(); await push([operation(p)]); await push([{ ...operation(p, 1), operation: "delete", payload: { id: p.id } }]);
		const page = await createServerSnapshot(db, binding); expect(page.aggregates[0]).toMatchObject({ id: p.id, version: 2, data: null }); expect(page.identities[0]).toMatchObject({ uuid: p.id, aggregateUuid: p.id, version: 2 }); expect(page.identities[0]!.deletedAt).not.toBeNull();
	});
	it("never splits multi-operation batches even when the target budget is smaller", async () => {
		await push([operation(profile(createUuid(), "x".repeat(70_000))), operation(profile())]); await push([operation(profile())]);
		const first = await readServerChanges(db, binding, "0", 10, 65_536); expect(first.batches).toHaveLength(1); expect(first.batches[0]!.changes).toHaveLength(2); expect(first).toMatchObject({ cursor: "2", highWaterCursor: "3", hasMore: true });
		const second = await readServerChanges(db, binding, first.cursor, 1); expect(second).toMatchObject({ cursor: "3", hasMore: false });
		expect((await readServerChanges(db, binding, "3")).batches).toEqual([]);
	});
	it.each(["1", "9", "01", "-1", "1.5", "9007199254740992"])("rejects unknown/mid-batch/noncanonical cursor %s", async (cursor) => {
		await push([operation(profile()), operation(profile())]); await expect(readServerChanges(db, binding, cursor)).rejects.toMatchObject({ code: "cursorInvalid" });
	});
	it("rejects old bindings on snapshots, pushes and pulls after an epoch change", async () => {
		const page = await createServerSnapshot(db, binding); const rotated = await rotateServerEpoch(db); expect(rotated.serverInstanceId).toBe(binding.serverInstanceId); expect(rotated.cursor).toBe(page.cursor);
		await expect(getSnapshotPage(db, binding, page.snapshotId, 0)).rejects.toMatchObject({ code: "serverChanged" });
		await expect(readServerChanges(db, binding, "0")).rejects.toMatchObject({ code: "serverChanged" }); await expect(push([operation(profile())])).rejects.toMatchObject({ code: "serverChanged" });
	});
	it("expires snapshots, bounds live downloads and cleans only expired ones", async () => {
		const page = await createServerSnapshot(db, binding); for (let i = 1; i < 4; i++) await createServerSnapshot(db, binding);
		await expect(createServerSnapshot(db, binding)).rejects.toMatchObject({ code: "snapshotBusy" });
		await db.withConnection((sql) => sql.write("UPDATE sync_snapshots SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE uuid=?", [page.snapshotId]));
		await expect(getSnapshotPage(db, binding, page.snapshotId, 0)).rejects.toMatchObject({ code: "snapshotExpired" }); await createServerSnapshot(db, binding);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM sync_snapshot_pages WHERE snapshot_uuid=?", [page.snapshotId]))).toEqual([{ n: 0 }]);
	});
	it("releases staged snapshots idempotently without changing business state or cursors", async () => {
		await push([operation(profile())]); const page = await createServerSnapshot(db, binding);
		expect(await releaseServerSnapshot(db, binding, page.snapshotId)).toEqual({ released: true }); expect(await releaseServerSnapshot(db, binding, page.snapshotId)).toEqual({ released: true });
		await expect(getSnapshotPage(db, binding, page.snapshotId, 0)).rejects.toMatchObject({ code: "snapshotExpired" }); expect((await serverInfo(db)).cursor).toBe("1");
	});
	it("includes deleted child UUID ownership as well as complete active roots", async () => {
		const f = { id: createUuid(), name_de: "F", name_en: "F", brand: null, ean: null, calories_per_100g: 0, fat_per_100g: 0, carbs_per_100g: 0, sugar_per_100g: 0, fiber_per_100g: 0, protein_per_100g: 0, salt_per_100g: 0, is_custom: 1, created_at: date, updated_at: null };
		const rid = createUuid(), child = { id: createUuid(), recipe_id: rid, food_id: f.id, sub_recipe_id: null, amount_grams: 1, created_at: date };
		const r = { id: rid, name_de: "R", name_en: "R", description: null, is_sub_recipe: 0, created_at: date, updated_at: null, ingredients: [child] };
		await push([{ ...operation(r), entity: "recipes" }, { ...operation(f), entity: "foods" }]);
		await push([{ ...operation({ ...r, ingredients: [] }, 1), entity: "recipes" }]);
		const page = await createServerSnapshot(db, binding); expect(page.aggregates.find((row) => row.id === rid)!.data!.ingredients).toEqual([]);
		expect(page.identities.find((row) => row.uuid === child.id)).toMatchObject({ entity: "recipe_ingredients", aggregateUuid: rid, version: 2, deletedAt: expect.any(String) });
	});
	it("rolls back partial snapshot persistence on late failures", async () => {
		const broken: ServerDatabase = { ...db, transaction: (fn) => db.transaction((sql) => fn({ ...sql, write: async (statement, values) => {
			if (statement.startsWith("UPDATE sync_snapshots")) throw new Error("private driver detail"); await sql.write(statement, values);
		} })) };
		await expect(createServerSnapshot(broken, binding)).rejects.toMatchObject({ code: "DB_READ_FAILED" }); expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM sync_snapshots"))).toEqual([{ n: 0 }]);
	});
	it("returns sanitized errors for corrupted change payloads and refuses log gaps", async () => {
		await push([operation(profile())]); await db.withConnection((sql) => sql.write("UPDATE change_log SET payload='{}'"));
		await expect(readServerChanges(db, binding, "0")).rejects.toMatchObject({ code: "DB_READ_FAILED" });
		await db.withConnection((sql) => sql.write("DELETE FROM change_log"));
		await expect(readServerChanges(db, binding, "1")).rejects.toMatchObject({ code: "cursorInvalid" });
	});
});
