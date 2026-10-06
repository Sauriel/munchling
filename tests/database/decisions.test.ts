import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { binding, date, food, page, profile, snapshot, url } from "../helpers/sync-wire";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createSyncDecisions } from "../../app/utils/sync/decisions";
import { createSyncQueue } from "../../app/utils/database/outbox";
import type { ServerAggregate } from "../../shared/domain/server";
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function open() { const db = await createTestDatabase(); opened.push(db); return db; }
afterEach(() => opened.splice(0).forEach((db) => db.close()));
async function stage(db: Awaited<ReturnType<typeof open>>, roots: ServerAggregate[]) {
	const store = createSnapshotStaging(db.database), epoch = (await store.state()).localEpoch, wire = snapshot(roots);
	await store.begin(epoch, url, wire); return { store, epoch, wire };
}
async function conflict(db: Awaited<ReturnType<typeof open>>) {
	const original = profile(), staged = await stage(db, [original]), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(staged.epoch);
	const id = (await db.service.profiles.listProfiles())[0]!.id; await db.service.profiles.updateProfile(id, { name: "Local" });
	const remote = profile("Server", original.id, 2); await receiver.applyPage({ ...binding, localEpoch: staged.epoch, url, cursor: "0" }, page([remote]));
	return { original, remote, receiver, id, wire: snapshot([remote], "1") };
}
describe("explicit sync decisions", () => {
	it("combines distinct same-named UUIDs without uploading, enabling or changing the local queue", async () => {
		const db = await open(); await db.service.profiles.createProfile({ name: "Remote", dailyCaloriesTarget: 2000 }); const before = await createSyncQueue(db.database).list();
		const { wire, store } = await stage(db, [profile()]), save = vi.fn(async () => {}), decisions = createSyncDecisions(db.database, save), review = await decisions.initialPreview();
		expect((await decisions.initialCommit(review.token, "combine", [wire])).status).toBe("applied"); expect(await db.service.profiles.listProfiles()).toHaveLength(2); expect(await createSyncQueue(db.database).list()).toEqual(before); expect((await store.state()).enabled).toBe(false); expect(save).toHaveBeenCalledOnce();
	});
	it("replaces only local data after explicit server choice, saves its exact backup and renews the epoch", async () => {
		const db = await open(); await db.service.profiles.createProfile({ name: "Before", dailyCaloriesTarget: 2000 }); const before = await db.service.backups!.exportBackup();
		const { wire, epoch, store } = await stage(db, [profile("After")]), save = vi.fn(async () => {}), decisions = createSyncDecisions(db.database, save), review = await decisions.initialPreview();
		await decisions.initialCommit(review.token, "server", [wire]); expect(save.mock.calls[0]![0].data).toEqual(before.data);
		expect((await db.service.profiles.listProfiles()).map(row => row.name)).toEqual(["After"]); expect(await createSyncQueue(db.database).list()).toEqual([]); expect((await store.state()).localEpoch).not.toBe(epoch); expect((await store.state()).enabled).toBe(false);
	});
	it("allows local-first only when the shared server has no active data", async () => {
		const db = await open(), { wire } = await stage(db, [profile()]), decisions = createSyncDecisions(db.database, vi.fn(async () => {}));
		await expect(decisions.initialCommit((await decisions.initialPreview()).token, "local", [wire])).rejects.toThrow("sharedDataReplacementForbidden");
	});
	it("rejects previews changed by local edits, server writes or restore before writing a backup", async () => {
		const db = await open(), original = profile(), { wire } = await stage(db, [original]), save = vi.fn(async () => {}), decisions = createSyncDecisions(db.database, save), review = await decisions.initialPreview();
		await expect(decisions.initialCommit(review.token, "combine", [snapshot([profile("New", original.id, 2)], "1")])).rejects.toThrow("previewChanged");
		await db.service.profiles.createProfile({ name: "New local", dailyCaloriesTarget: 2000 }); await expect(decisions.initialCommit(review.token, "combine", [wire])).rejects.toThrow("previewChanged"); expect(save).not.toHaveBeenCalled();
	});
	it("preserves the complete database if the independent safety writer fails", async () => {
		const db = await open(); await db.service.profiles.createProfile({ name: "Before", dailyCaloriesTarget: 2000 }); const { wire } = await stage(db, [profile()]);
		const save = vi.fn(async () => { throw new Error("disk full"); }), decisions = createSyncDecisions(db.database, save), before = await createSyncQueue(db.database).list();
		await expect(decisions.initialCommit((await decisions.initialPreview()).token, "server", [wire])).rejects.toThrow("disk full"); expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Before"); expect(await createSyncQueue(db.database).list()).toEqual(before); expect(await createSnapshotStaging(db.database).progress()).not.toBeNull();
	});
	it("accepts the server explicitly, retires pending intent and releases blocked groups without echo", async () => {
		const db = await open(), { remote, wire, id, receiver } = await conflict(db), save = vi.fn(async () => {}), decisions = createSyncDecisions(db.database, save), review = await decisions.conflictPreview([wire]);
		expect(review.entries[0]!.local!.name).toBe("Local"); expect(review.entries[0]!.remote!.data!.name).toBe("Server");
		await decisions.resolve(review.token, { [remote.id]: "server" }, [wire]); expect((await db.service.profiles.listProfiles())[0]).toMatchObject({ id, name: "Server" }); expect(await createSyncQueue(db.database).list()).toEqual([]); expect(await receiver.conflicts()).toEqual([]); expect(await db.database.query("SELECT id FROM sync_inbox WHERE status='blocked';")).toEqual([]); expect((await createSnapshotStaging(db.database).state()).cursor).toBe("1");
	});
	it("can explicitly discard a newer draft even when the server revision was already acknowledged", async () => {
		const db = await open(), original = profile(), { epoch } = await stage(db, [original]), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(epoch);
		const id = (await db.service.profiles.listProfiles())[0]!.id; await db.service.profiles.updateProfile(id, { name: "Accepted" }); const queue = createSyncQueue(db.database), inflight = await queue.claimNextBatch(), remote = profile("Accepted", original.id, 2);
		await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([remote]));
		await queue.acknowledgeBatch(inflight[0]!.batchId, inflight.map(row => ({ operationId: row.operationId, serverRevision: 2 })));
		await db.service.profiles.updateProfile(id, { name: "Newer draft" }); const wire = snapshot([remote], "1"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]);
		await decisions.resolve(review.token, { [remote.id]: "server" }, [wire]); expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Accepted"); expect(await queue.list()).toEqual([]);
	});
	it("keeps local through a new explicit versioned operation, persisting immutable IDs after restart", async () => {
		const db = await open(), { remote, wire } = await conflict(db), old = await createSyncQueue(db.database).list(), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]);
		await decisions.resolve(review.token, { [remote.id]: "local" }, [wire]); const queued = await createSyncQueue(db.database).list(); expect(queued).toHaveLength(1); expect(queued[0]).toMatchObject({ baseRevision: 2, status: "pending", payload: { name: "Local" } }); expect(queued[0]!.operationId).not.toBe(old[0]!.operationId);
		const reopened = await createTestDatabase({ bytes: db.exportBytes() }); opened.push(reopened); expect(await createSyncQueue(reopened.database).list()).toEqual(queued);
	});
	it("includes whole pending transactions without silently dropping companion operations", async () => {
		const db = await open(), a = profile("A"), b = profile("B"), { epoch } = await stage(db, [a, b]), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(epoch);
		await db.database.transaction(async sql => { await sql.run("UPDATE profiles SET name='Local A' WHERE uuid=?;", [a.id]); await sql.run("UPDATE profiles SET name='Local B' WHERE uuid=?;", [b.id]); });
		const old = await createSyncQueue(db.database).list(); expect(new Set(old.map(row => row.batchId)).size).toBe(1);
		const remoteA = profile("Remote A", a.id, 2); await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([remoteA]));
		const wire = snapshot([remoteA, b], "1"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]); expect(review.entries.map(entry => entry.id).sort()).toEqual([a.id, b.id].sort());
		await expect(decisions.resolve(review.token, { [a.id]: "server" }, [wire])).rejects.toThrow("invalidDecision");
		await decisions.resolve(review.token, { [a.id]: "server", [b.id]: "local" }, [wire]); const next = await createSyncQueue(db.database).list(); expect(next).toHaveLength(1); expect(next[0]).toMatchObject({ entityUuid: b.id, baseRevision: 1, payload: { name: "Local B" } }); expect(next[0]!.batchId).not.toBe(old[0]!.batchId);
	});
	it("rolls back queue cancellation, conflict deletion and registry after a late SQL failure", async () => {
		const db = await open(), { remote, wire, receiver } = await conflict(db), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]), oldQueue = await createSyncQueue(db.database).list(), oldConflicts = await receiver.conflicts();
		await db.database.execute("CREATE TRIGGER fail_decision BEFORE UPDATE ON profiles WHEN NEW.name='Server' BEGIN SELECT RAISE(ABORT,'injected'); END;");
		await expect(decisions.resolve(review.token, { [remote.id]: "server" }, [wire])).rejects.toThrow("injected"); expect(await createSyncQueue(db.database).list()).toEqual(oldQueue); expect(await receiver.conflicts()).toEqual(oldConflicts); expect((await db.service.profiles.listProfiles())[0]!.name).toBe("Local");
	});
	it("includes low-level business changes in the preview fingerprint too", async () => {
		const db = await open(), { remote, wire } = await conflict(db), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]);
		await db.database.transaction(async sql => { await sql.run("UPDATE sync_state SET tracking_enabled=0 WHERE id=1;"); await sql.run("UPDATE profiles SET name='Suppressed change' WHERE uuid=?;", [remote.id]); await sql.run("UPDATE sync_state SET tracking_enabled=1 WHERE id=1;"); });
		await expect(decisions.resolve(review.token, { [remote.id]: "server" }, [wire])).rejects.toThrow("previewChanged");
	});
	it("invalidates a decision after local restore and preserves renewed initial operations", async () => {
		const db = await open(), { remote, wire } = await conflict(db), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]);
		await db.service.backups!.restoreBackup(await db.service.backups!.exportBackup(), vi.fn(async () => {})); const before = await createSyncQueue(db.database).list();
		await expect(decisions.resolve(review.token, { [remote.id]: "server" }, [wire])).rejects.toThrow("notInitialized"); expect(await createSyncQueue(db.database).list()).toEqual(before);
	});
	it("will not discard an in-flight request with an unknown remote outcome", async () => {
		const db = await open(), { wire } = await conflict(db), queue = createSyncQueue(db.database); const inflight = await queue.claimNextBatch();
		await expect(createSyncDecisions(db.database, vi.fn(async () => {})).conflictPreview([wire])).rejects.toThrow("unconfirmedUpload"); expect(await queue.claimNextBatch()).toEqual(inflight);
	});
	it("requires a new preview for a newer server version or a newer local draft", async () => {
		const db = await open(), { remote, wire, id } = await conflict(db), save = vi.fn(async () => {}), decisions = createSyncDecisions(db.database, save), review = await decisions.conflictPreview([wire]);
		await expect(decisions.resolve(review.token, { [remote.id]: "local" }, [snapshot([profile("New server", remote.id, 3)], "2")])).rejects.toThrow("previewChanged");
		await db.service.profiles.updateProfile(id, { name: "New draft" }); await expect(decisions.resolve(review.token, { [remote.id]: "server" }, [wire])).rejects.toThrow("previewChanged"); expect(save).not.toHaveBeenCalled();
	});
	it("requires explicit deletion/resurrection confirmation", async () => {
		const db = await open(), { remote, receiver } = await conflict(db), store = createSnapshotStaging(db.database), state = await store.state(), deleted = { ...remote, version: 3, deletedAt: date, data: null };
		await receiver.applyPage({ ...binding, localEpoch: state.localEpoch, url, cursor: "1" }, page([deleted], 1)); const wire = snapshot([deleted], "2"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]);
		await expect(decisions.resolve(review.token, { [remote.id]: "local" }, [wire])).rejects.toThrow("confirmDeletion"); await decisions.resolve(review.token, { [remote.id]: "local" }, [wire], true); expect((await createSyncQueue(db.database).list())[0]!.baseRevision).toBe(3);
	});
	it("blocks accepting a deletion that would cascade away a local-only dependent", async () => {
		const db = await open(), f = food(), { epoch } = await stage(db, [f]), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(epoch);
		await db.service.recipes.createRecipe({ nameDe: "Local", nameEn: "Local", ingredients: [{ foodId: (await db.service.foods.listFoods())[0]!.id, amountGrams: 25 }] });
		const deleted = { ...f, version: 2, data: null, deletedAt: date }; await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([deleted])); const wire = snapshot([deleted], "1"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]), before = await createSyncQueue(db.database).list();
		const choices = Object.fromEntries(review.entries.map(entry => [entry.id, entry.id === f.id ? "server" as const : "local" as const]));
		await expect(decisions.resolve(review.token, choices, [wire], true)).rejects.toThrow("serverDependency"); expect(await db.service.recipes.listRecipes()).toHaveLength(1); expect(await createSyncQueue(db.database).list()).toEqual(before);
	});
	it("includes historical EAN collisions so editing an EAN does not leave a doomed old upload", async () => {
		const db = await open(), remote = food("C"), { epoch } = await stage(db, []), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(epoch);
		const id = await db.service.foods.createFood({ nameDe: "Local", nameEn: "Local", ean: "C", caloriesPer100g: 50, fatPer100g: 0, carbsPer100g: 0, sugarPer100g: 0, fiberPer100g: 0, proteinPer100g: 0, saltPer100g: 0 });
		await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([remote]));
		await db.service.foods.updateFood(id!.id, { ean: null });
		const wire = snapshot([remote], "1"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]); expect(review.entries).toHaveLength(2);
		const choices = Object.fromEntries(review.entries.map(entry => [entry.id, entry.id === remote.id ? "server" as const : "local" as const]));
		await decisions.resolve(review.token, choices, [wire]); const pending = await createSyncQueue(db.database).list(); expect(pending).toHaveLength(1); expect(pending[0]!.payload.ean).toBeNull(); expect(await db.service.foods.listFoods()).toHaveLength(2);
	});
	it("checks EAN collisions against the entire current shared dataset before queuing a local winner", async () => {
		const db = await open(), f = food("A"), { epoch } = await stage(db, [f]), receiver = createRemoteReceiver(db.database); await receiver.adoptSnapshot(epoch);
		await db.service.foods.updateFood((await db.service.foods.listFoods())[0]!.id, { ean: "B" }); const remote = food("A", f.id, 2), other = food("B"); await receiver.applyPage({ ...binding, localEpoch: epoch, url, cursor: "0" }, page([remote]));
		const wire = snapshot([remote, other], "2"), decisions = createSyncDecisions(db.database, vi.fn(async () => {})), review = await decisions.conflictPreview([wire]); await expect(decisions.resolve(review.token, { [f.id]: "local" }, [wire])).rejects.toThrow("eanConflict");
	});
});
