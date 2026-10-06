import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
// Small, self-consistent transport budgets exercise the exact production
// rollback paths without allocating hundreds of MiB in the test runner.
vi.mock("../../shared/domain/protocol", async (original) => {
	const module = await original<typeof import("../../shared/domain/protocol")>();
	return { ...module, syncLimits: { ...module.syncLimits, batchBytes: 2000, defaultPageBytes: 1024, minPageBytes: 128, maxPageBytes: 1024, maxSnapshotBytes: 1500 } };
});
import type { ServerDatabase } from "../../server/database/connection";
import type { ServerBinding } from "../../shared/domain/protocol";
import type { ServerOperation } from "../../shared/domain/server";
import { readServerState } from "../../server/database/state";
import { writeServerBatch } from "../../server/services/write";
import { readServerAggregate } from "../../server/services/storage";
import { createServerSnapshot } from "../../server/services/read";
import { createUuid } from "../../shared/domain/sync";
import { newDatabase, resetDatabase } from "./helpers";
const date = "2026-10-05T12:00:00.000Z";
describe("bounded atomic transfer rollback", () => {
	let db: ServerDatabase, binding: ServerBinding;
	beforeAll(() => { db = newDatabase(); }); afterAll(async () => { await db.close(); });
	beforeEach(async () => { await resetDatabase(db); const state = await db.withConnection(readServerState); binding = { serverInstanceId: state.instance_uuid, serverEpoch: state.epoch_uuid }; });
	const push = (operations: ServerOperation[], guards: unknown[] = []) => writeServerBatch(db, { ...binding, batchId: createUuid(), operations, guards });
	async function populated() {
		const f = { id: createUuid(), name_de: "F", name_en: "F", brand: null, ean: null, calories_per_100g: 0, fat_per_100g: 0, carbs_per_100g: 0, sugar_per_100g: 0, fiber_per_100g: 0, protein_per_100g: 0, salt_per_100g: 0, is_custom: 1, created_at: date, updated_at: null };
		await push([{ operationId: createUuid(), entity: "foods", entityUuid: f.id, baseRevision: 0, operation: "upsert", payload: f }]);
		const recipes = [];
		for (let i = 0; i < 2; i++) {
			const id = createUuid(), r = { id, name_de: "r".repeat(900), name_en: "R", description: null, is_sub_recipe: 0, created_at: date, updated_at: null, ingredients: [{ id: createUuid(), recipe_id: id, food_id: f.id, sub_recipe_id: null, amount_grams: 1, created_at: date }] };
			await push([{ operationId: createUuid(), entity: "recipes", entityUuid: id, baseRevision: 0, operation: "upsert", payload: r }]); recipes.push(r);
		}
		return { f, recipes };
	}
	it("rejects an oversized implicit cascade without leaving tombstones, changed versions, receipts or cursor", async () => {
		const { f, recipes } = await populated();
		await expect(push([{ operationId: createUuid(), entity: "foods", entityUuid: f.id, baseRevision: 1, operation: "delete", payload: { id: f.id } }], recipes.map((r) => ({ entity: "recipes", entityUuid: r.id, baseRevision: 1 })))).rejects.toMatchObject({ code: "batchTooLarge" });
		expect(await readServerAggregate(db, "foods", f.id)).toMatchObject({ version: 1, deletedAt: null });
		for (const r of recipes) expect(await readServerAggregate(db, "recipes", r.id)).toMatchObject({ version: 1, data: { ingredients: [expect.objectContaining({ food_id: f.id })] } });
		expect((await db.withConnection(readServerState)).last_cursor).toBe(3); expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_batches"))).toEqual([{ n: 3 }]);
	});
	it("rejects an oversized snapshot and rolls back its already staged pages and quota reservation", async () => {
		await populated(); await expect(createServerSnapshot(db, binding)).rejects.toMatchObject({ code: "snapshotLimit" });
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM sync_snapshots"))).toEqual([{ n: 0 }]); expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM sync_snapshot_pages"))).toEqual([{ n: 0 }]);
		expect((await db.withConnection(readServerState)).last_cursor).toBe(3);
	});
});
