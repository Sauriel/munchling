import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase } from "../helpers/sqlite";
import { createSqlDatabase } from "../../app/utils/database/executor";
import { runLocalMigrations } from "../../app/utils/database/migrations";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createUuid } from "../../shared/domain/sync";
import type { SnapshotPage } from "../../shared/domain/protocol";
const date = "2026-10-05T12:00:00.000Z";
const binding = { serverInstanceId: createUuid(), serverEpoch: createUuid() };
const opened: Awaited<ReturnType<typeof createTestDatabase>>[] = [];
async function open(options: Parameters<typeof createTestDatabase>[0] = {}) { const db = await createTestDatabase(options); opened.push(db); return db; }
afterEach(() => { opened.splice(0).forEach((db) => db.close()); });
function snapshot(): SnapshotPage {
	const id = createUuid();
	return { ...binding, protocolVersion: 1, snapshotId: createUuid(), cursor: "1", expiresAt: "2099-10-05T12:00:00.000Z", page: 0, pageCount: 1, nextPage: null,
		aggregates: [{ entity: "profiles", id, version: 1, deletedAt: null, data: { id, name: "Remote", daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: date, updated_at: null } }],
		identities: [{ uuid: id, entity: "profiles", aggregateUuid: id, version: 1, deletedAt: null }] };
}
describe("durable receive staging", () => {
	it("upgrades v2 without changing business UUIDs, outbox, backup representation or tracking", async () => {
		const db = await open({ version: 2 }); await db.service.profiles.createProfile({ name: "Local", dailyCaloriesTarget: 2000 });
		const before = await db.service.backups!.exportBackup(), outbox = await createSyncQueue(db.database).list();
		await runLocalMigrations(createSqlDatabase(db.driver), vi.fn());
		expect((await db.service.backups!.exportBackup()).data).toEqual(before.data); expect((await db.service.backups!.exportBackup()).version).toBe(2); expect(await createSyncQueue(db.database).list()).toEqual(outbox);
		expect(await db.database.query("SELECT version FROM schema_migrations ORDER BY version")).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
	});
	it("rolls back failed v3 DDL and permits a clean retry", async () => {
		const db = await open({ version: 2 }); const execute = db.driver.execute;
		const spy = vi.spyOn(db.driver, "execute").mockImplementation((text, tx) => execute(text.includes("CREATE TABLE sync_download") ? `${text}; INSERT INTO absent VALUES(1);` : text, tx));
		await expect(runLocalMigrations(createSqlDatabase(db.driver), vi.fn())).rejects.toThrow(); spy.mockRestore();
		expect((await db.database.query<{ name: string }>("PRAGMA table_info(sync_state)")).some((row) => row.name === "server_epoch")).toBe(false);
		await runLocalMigrations(createSqlDatabase(db.driver), vi.fn()); expect((await createSnapshotStaging(db.database).state()).serverEpoch).toBe("");
	});
	it("resumes persisted pages after reopening and never changes local data or cursor during download", async () => {
		const db = await open(); const store = createSnapshotStaging(db.database), state = await store.state(), whole = snapshot();
		const first = { ...whole, pageCount: 2, nextPage: 1, identities: [] }; const last = { ...whole, page: 1, pageCount: 2, aggregates: [], nextPage: null };
		await store.begin(state.localEpoch, "https://example.org", first); const reloaded = await open({ bytes: db.exportBytes() }), next = createSnapshotStaging(reloaded.database);
		expect((await next.progress())!.row.next_page).toBe(1); await next.save(last); await next.save(last);
		expect((await next.complete()).snapshot.aggregates).toHaveLength(1); expect((await next.state()).cursor).toBeNull(); expect(await reloaded.service.profiles.listProfiles()).toEqual([]);
	});
	it("rejects skipped, altered, incomplete and mixed-cut pages", async () => {
		const db = await open(), store = createSnapshotStaging(db.database), state = await store.state(), page = snapshot();
		const first = { ...page, pageCount: 3, nextPage: 1 }; await store.begin(state.localEpoch, "https://example.org", first);
		await expect(store.complete()).rejects.toThrow("incompleteSnapshot");
		await expect(store.save({ ...first, page: 2, nextPage: null })).rejects.toThrow("incompleteSnapshot");
		await expect(store.save({ ...first, page: 1, nextPage: 2, cursor: "2" })).rejects.toThrow("invalidResponse");
		await expect(store.save({ ...first, aggregates: [] })).rejects.toThrow("changedSnapshot");
	});
	it("rejects global duplicate UUIDs, incomplete registry and dangling references before acceptance", async () => {
		const db = await open(), store = createSnapshotStaging(db.database), state = await store.state(), page = snapshot();
		await store.begin(state.localEpoch, "https://example.org", { ...page, identities: [] }); await expect(store.complete()).rejects.toThrow("invalidResponse"); await store.discard();
		const first = { ...page, pageCount: 2, nextPage: 1 }; await store.begin(state.localEpoch, "https://example.org", first); await store.save({ ...page, page: 1, pageCount: 2 }); await expect(store.complete()).rejects.toThrow("invalidResponse");
	});
	it("audits previously committed pages before resuming and rejects corrupted persisted history", async () => {
		const db = await open(), store = createSnapshotStaging(db.database), state = await store.state(), page = snapshot();
		await store.begin(state.localEpoch, "https://example.org", { ...page, pageCount: 2, nextPage: 1 }); expect((await store.audit())!.row.next_page).toBe(1);
		await db.database.run("UPDATE sync_download_pages SET payload=? WHERE page_index=0;", [JSON.stringify({ ...page, cursor: "2", pageCount: 2, nextPage: 1 })]); await expect(store.audit()).rejects.toThrow("invalidResponse");
	});
	it("protects a download against restore and stale asynchronous responses", async () => {
		const db = await open(), store = createSnapshotStaging(db.database), state = await store.state(), page = snapshot(); const backup = await db.service.backups!.exportBackup();
		await store.begin(state.localEpoch, "https://example.org", page); await db.service.backups!.restoreBackup(backup, vi.fn(async () => {}));
		expect(await store.progress()).toBeNull(); expect((await store.state()).localEpoch).not.toBe(state.localEpoch);
		await expect(store.begin(state.localEpoch, "https://example.org", page)).rejects.toThrow("localReset");
	});
	it("does not silently replace an existing binding, active download or seeded installation", async () => {
		const db = await open(), store = createSnapshotStaging(db.database), state = await store.state(), page = snapshot();
		await store.begin(state.localEpoch, "https://example.org", page); await expect(store.begin(state.localEpoch, "https://other.org", page)).rejects.toThrow("downloadExists"); await store.discard();
		await db.database.run("UPDATE sync_state SET development_seeded=1 WHERE id=1"); await expect(store.begin(state.localEpoch, "https://example.org", page)).rejects.toThrow("developmentSeeded");
	});
});
