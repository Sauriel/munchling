import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { binding, url, profile, snapshot } from "../helpers/sync-wire";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createManualSyncRunner } from "../../app/utils/sync/runner";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { syncLimits } from "../../shared/domain/protocol";
import { syncEntities } from "../../shared/domain/sync";
import type { ChangeBatch } from "../../shared/domain/protocol";
import type { ServerAggregate, ServerWriteBatch, ServerReceipt } from "../../shared/domain/server";
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
afterEach(() => { opened.splice(0).forEach(t => t.close()); });
async function open(bytes?: Uint8Array) { const t = await createTestDatabase({ bytes }); opened.push(t); return t; }
async function connect(t: Awaited<ReturnType<typeof open>>) {
	const stage = createSnapshotStaging(t.database), state = await stage.state();
	await stage.begin(state.localEpoch, url, snapshot([])); await createRemoteReceiver(t.database).adoptSnapshot(state.localEpoch);
}
function server() {
	const feed: ChangeBatch[] = [], roots = new Map<string, ServerAggregate>(), receipts = new Map<string, ServerReceipt>(), bodies: string[] = [];
	let cursor = 0, lose = false, reject = false;
	const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
	function commit(batch: ServerWriteBatch) {
		const changes = batch.operations.map(op => {
			const root: ServerAggregate = { entity: op.entity, id: op.entityUuid, version: op.baseRevision + 1, deletedAt: op.operation === "delete" ? new Date().toISOString() : null, data: op.operation === "delete" ? null : op.payload };
			roots.set(root.id, root); return { cursor: String(++cursor), aggregate: root };
		});
		feed.push({ batchId: batch.batchId, firstCursor: changes[0]!.cursor, lastCursor: String(cursor), changes });
		const receipt: ServerReceipt = { ...binding, batchId: batch.batchId, cursor: String(cursor), operations: batch.operations.map(op => ({ operationId: op.operationId, entity: op.entity, entityUuid: op.entityUuid, serverRevision: op.baseRevision + 1 })), changes: changes.map(c => ({ entity: c.aggregate.entity, entityUuid: c.aggregate.id, serverRevision: c.aggregate.version })) };
		receipts.set(batch.batchId, receipt); return receipt;
	}
	const fetcher = vi.fn<typeof fetch>(async (input, init) => {
		const target = new URL(String(input));
		if (target.pathname.endsWith("info")) return json({ ...binding, protocolVersion: 1, schemaVersion: 2, cursor: String(cursor), limits: syncLimits, capabilities: { authentication: "none", fullAggregates: true, atomicBatches: true, manualConflicts: true }, counts: syncEntities.map(entity => ({ entity, active: 0, deleted: 0 })) });
		if (target.pathname.endsWith("changes")) { const from = target.searchParams.get("cursor")!; return json({ ...binding, protocolVersion: 1, fromCursor: from, cursor: String(cursor), highWaterCursor: String(cursor), hasMore: false, batches: feed.filter(b => Number(b.firstCursor) > Number(from)) }); }
		bodies.push(String(init!.body)); const request = JSON.parse(String(init!.body)) as ServerWriteBatch;
		if (reject) return json({ error: { code: "versionConflict", resync: false, retryable: false, current: [] } }, 409);
		const receipt = receipts.get(request.batchId) ?? commit(request);
		if (lose) { lose = false; throw new TypeError("lost receipt"); }
		return json(receipt);
	});
	return { fetcher, bodies, feed, roots, lose: () => { lose = true; }, reject: () => { reject = true; }, remote: (root: ServerAggregate) => { roots.set(root.id, root); feed.push({ batchId: crypto.randomUUID(), firstCursor: String(cursor + 1), lastCursor: String(++cursor), changes: [{ cursor: String(cursor), aggregate: root }] }); } };
}

describe("manual native sync runner", () => {
	it("uploads local data, advances queued bases and pulls server edits/new records without echo", async () => {
		const t = await open(), local = (await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }))!;
		await t.service.profiles.updateProfile(local.id, { name: "Latest" }); await connect(t);
		const s = server(), run = createManualSyncRunner(t.database, { fetch: s.fetcher });
		expect((await run.sync(true)).uploaded).toBe(2);
		expect(JSON.parse(s.bodies[1]!).operations[0].baseRevision).toBe(1);
		const uuid = (await t.database.query<{ uuid: string }>("SELECT uuid FROM profiles WHERE id=?;", [local.id]))[0]!.uuid;
		s.remote(profile("Website edit", uuid, 3)); s.remote(profile("New web profile"));
		const result = await run.sync(true); expect(result.uploaded).toBe(0); expect(result.received).toBe(2);
		expect((await t.service.profiles.getProfileById(local.id))!.name).toBe("Website edit");
		expect(await t.service.profiles.listProfiles()).toHaveLength(2); expect(await createSyncQueue(t.database).list()).toEqual([]);
		expect((await run.status()).state.enabled).toBe(false);
	});
	it("replays the identical uncertain upload after restart BEFORE pulling and preserves newer local draft", async () => {
		let t = await open(); const p = (await t.service.profiles.createProfile({ name: "Original", dailyCaloriesTarget: 2000 }))!; await connect(t);
		const s = server(); s.lose(); await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("network");
		await t.service.profiles.updateProfile(p.id, { name: "Edited while uncertain" });
		t = await open(t.exportBytes()); const run = createManualSyncRunner(t.database, { fetch: s.fetcher });
		expect((await run.status()).uncertain).toBe(true); await run.sync(true);
		expect(s.bodies[0]).toBe(s.bodies[1]); expect(s.roots.size).toBe(1);
		expect(JSON.parse(s.bodies[2]!).operations[0].baseRevision).toBe(1);
		expect((await t.service.profiles.getProfileById(p.id))!.name).toBe("Edited while uncertain");
		expect((await run.status()).uncertain).toBe(false); expect((await run.status()).blocked).toBe(0);
	});
	it("does not upload while a remote conflict is blocked and leaves original pending bases", async () => {
		const t = await open(), p = (await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }))!; await connect(t);
		const s = server(), run = createManualSyncRunner(t.database, { fetch: s.fetcher }); await run.sync(true);
		await t.service.profiles.updateProfile(p.id, { name: "Local draft" }); const queue = await createSyncQueue(t.database).list();
		s.remote(profile("Remote edit", queue[0]!.entityUuid, 2));
		await expect(run.sync(true)).rejects.toThrow("conflictsPending"); expect(await createSyncQueue(t.database).list()).toEqual(queue); expect(s.bodies).toHaveLength(1);
		expect((await run.status()).blocked).toBe(1); expect((await t.service.profiles.getProfileById(p.id))!.name).toBe("Local draft");
	});
	it("returns a definitive rejection to pending without discarding it or inventing fresh bases", async () => {
		const t = await open(); await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }); await connect(t); const s = server(); s.reject();
		const before = await createSyncQueue(t.database).list(), run = createManualSyncRunner(t.database, { fetch: s.fetcher });
		await expect(run.sync(true)).rejects.toThrow("versionConflict"); expect(await createSyncQueue(t.database).list()).toEqual(before); expect((await run.status()).uncertain).toBe(false);
	});
	it("does not send without consent and excludes overlapping runner instances", async () => {
		const t = await open(); await connect(t); const s = server(); const run = createManualSyncRunner(t.database, { fetch: s.fetcher });
		await expect(run.sync()).rejects.toThrow("confirmSync"); expect(s.fetcher).not.toHaveBeenCalled();
		let release!: () => void; const gate = new Promise<void>(r => { release = r; }); s.fetcher.mockImplementationOnce(async () => { await gate; throw new TypeError("network"); });
		const first = run.sync(true); await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("syncBusy"); release(); await expect(first).rejects.toThrow("network");
	});
	it("keeps a confirmed receipt through acknowledgement failure and never posts it again", async () => {
		const t = await open(); await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }); await connect(t); const s = server();
		const raw = t.driver.run; const spy = vi.spyOn(t.driver, "run").mockImplementation(async (sql, values) => { if (sql.startsWith("DELETE FROM sync_outbox WHERE batch_id")) throw new Error("disk failure"); return raw(sql, values); });
		await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("disk failure"); spy.mockRestore();
		expect((await t.database.query<{ receipt: string | null }>("SELECT receipt FROM sync_upload;"))[0]!.receipt).not.toBeNull();
		const offline: typeof fetch = async () => { throw new TypeError("server offline"); };
		await expect(createManualSyncRunner(t.database, { fetch: offline }).sync(true)).rejects.toThrow("network");
		expect((await createManualSyncRunner(t.database).status()).uncertain).toBe(false);
		await createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true); expect(s.bodies).toHaveLength(1); expect(await createSyncQueue(t.database).list()).toEqual([]);
	});
	it("retains unknown outcomes on 5xx and refuses a corrupted or epoch-mismatched journal without repost", async () => {
		const t = await open(); await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }); await connect(t); const s = server();
		const transport: typeof fetch = async (input, init) => String(input).endsWith("push") ? new Response(JSON.stringify({ error: { code: "DB_WRITE_FAILED", resync: false, retryable: true } }), { status: 503, headers: { "content-type": "application/json" } }) : s.fetcher(input, init);
		await expect(createManualSyncRunner(t.database, { fetch: transport }).sync(true)).rejects.toThrow("DB_WRITE_FAILED");
		expect((await createManualSyncRunner(t.database).status()).uncertain).toBe(true);
		const old = (await t.database.query<{ request: string }>("SELECT request FROM sync_upload;"))[0]!.request;
		await t.database.run("UPDATE sync_upload SET request='{}';");
		await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("writeJournalInvalid"); expect(s.bodies).toHaveLength(0);
		await t.database.run("UPDATE sync_upload SET request=?;", [old]);
		await t.database.run("UPDATE sync_state SET local_epoch=? WHERE id=1;", [crypto.randomUUID()]);
		await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("localReset"); expect(s.bodies).toHaveLength(0);
	});
	it("refuses local restore while an upload outcome is uncertain", async () => {
		const t = await open(); await t.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 }); await connect(t); const s = server(); s.lose();
		await expect(createManualSyncRunner(t.database, { fetch: s.fetcher }).sync(true)).rejects.toThrow("network");
		const backup = await t.service.backups!.exportBackup(); await expect(t.service.backups!.restoreBackup(backup, async () => {})).rejects.toThrow("unconfirmedUpload");
		expect((await createManualSyncRunner(t.database).status()).uncertain).toBe(true);
	});
});
