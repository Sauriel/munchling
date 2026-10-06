import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { binding, page, profile, snapshot, url } from "../helpers/sync-wire";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createSyncDisconnect } from "../../app/utils/sync/disconnect";
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function setup() {
	const db = await createTestDatabase(); opened.push(db); const store = createSnapshotStaging(db.database), before = await store.state(), p = profile();
	await store.begin(before.localEpoch, url, snapshot([p])); await createRemoteReceiver(db.database).adoptSnapshot(before.localEpoch); await db.service.profiles.updateProfile((await db.service.profiles.listProfiles())[0]!.id, { name: "Local" });
	return { db, store, before, p };
}
afterEach(() => opened.splice(0).forEach(db => db.close()));
describe("explicit offline-capable local detachment", () => {
	it("preserves all data and identities, renews the epoch and replaces old requests with latest unbound intents", async () => {
		const { db, store, before, p } = await setup(), backup = await db.service.backups!.exportBackup(), old = await createSyncQueue(db.database).list(), save = vi.fn(async () => {}), disconnect = createSyncDisconnect(db.database, save), review = await disconnect.preview();
		await disconnect.commit(review.token, true); const after = await store.state(), exported = await db.service.backups!.exportBackup(); expect(exported.data).toEqual(backup.data); expect(exported.version === 2 && backup.version === 2 && exported.identities).toEqual(backup.version === 2 ? backup.identities : []);
		expect(after).toMatchObject({ url: null, cursor: null, serverInstanceId: "", serverEpoch: "", enabled: false }); expect(after.localEpoch).not.toBe(before.localEpoch); expect(save).toHaveBeenCalledOnce();
		const queue = await createSyncQueue(db.database).list(); expect(queue).toHaveLength(1); expect(queue[0]).toMatchObject({ baseRevision: 0, entityUuid: p.id, payload: { name: "Local" } }); expect(queue[0]!.batchId).not.toBe(old[0]!.batchId);
		await expect(createRemoteReceiver(db.database).applyPage({ ...binding, localEpoch: before.localEpoch, url, cursor: "0" }, page([profile("Stale", p.id, 2)]))).rejects.toThrow("localReset"); expect(await createSyncQueue(db.database).list()).toEqual(queue);
	});
	it("requires confirmation, an unchanged ticket and no uncertain in-flight operations", async () => {
		const { db } = await setup(), disconnect = createSyncDisconnect(db.database, vi.fn(async () => {})), review = await disconnect.preview(); await expect(disconnect.commit(review.token)).rejects.toThrow("confirmDisconnect");
		await db.service.profiles.updateProfile((await db.service.profiles.listProfiles())[0]!.id, { name: "Later" }); await expect(disconnect.commit(review.token, true)).rejects.toThrow("previewChanged"); const queue = createSyncQueue(db.database), claimed = await queue.claimNextBatch(); await expect(disconnect.preview()).rejects.toThrow("unconfirmedUpload"); expect(await queue.claimNextBatch()).toEqual(claimed);
	});
	it("does not detach if saving the backup or rebuilding the queue fails", async () => {
		const { db, store } = await setup(), state = await store.state(), old = await createSyncQueue(db.database).list(), fail = createSyncDisconnect(db.database, async () => { throw new Error("disk full"); });
		await expect(fail.commit((await fail.preview()).token, true)).rejects.toThrow("disk full"); expect(await store.state()).toEqual(state);
		await db.database.execute("CREATE TRIGGER fail_unbound BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT,'injected'); END;"); const disconnect = createSyncDisconnect(db.database, vi.fn(async () => {})); await expect(disconnect.commit((await disconnect.preview()).token, true)).rejects.toThrow("injected"); expect(await store.state()).toEqual(state); expect(await createSyncQueue(db.database).list()).toEqual(old);
	});
});
