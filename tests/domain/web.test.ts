import { describe, expect, it } from "vitest";
import { binding, profile, snapshot, url } from "../helpers/sync-wire";
import { syncLimits } from "../../shared/domain/protocol";
import { replyWebState, type WebState } from "../../shared/domain/web";
import { createWebView } from "../../app/utils/data/web-view";
import { createHttpDataService, type WebWriteLock } from "../../app/utils/data/http";
import { SyncClientError } from "../../shared/domain/replies";
const lock: WebWriteLock = { run: async (_key, action) => action() };
const info = { ...binding, protocolVersion: 1, schemaVersion: 3, cursor: "0", counts: [], capabilities: { authentication: "none", fullAggregates: true, manualConflicts: true, atomicBatches: true }, limits: syncLimits };
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function store() { const values = new Map<string,string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key,value); }, removeItem: (key: string) => { values.delete(key); } }; }
function fixture(): WebState { const p = profile(); return { snapshot: snapshot([p]), viewIds: [{ entity: "profiles", uuid: p.id, id: 7 }] }; }
describe("online web view and write fences", () => {
	it("validates registry ownership, all active mappings and positive unique view IDs", async () => {
		const state = fixture(); expect((await createWebView(replyWebState(state, binding)).read.profiles.listProfiles())[0]).toMatchObject({ id: 7, revision: 1 });
		for (const viewIds of [[], [{ ...state.viewIds[0]!, id: 0 }], [state.viewIds[0]!, state.viewIds[0]!], [{ ...state.viewIds[0]!, entity: "foods" }]]) expect(() => replyWebState({ ...state, viewIds }, binding)).toThrow("invalidResponse");
		expect(() => replyWebState({ ...state, snapshot: { ...state.snapshot, serverEpoch: profile().id } }, binding)).toThrow();
	});
	it("requires the explicit form revision, never silently using a newer read", async () => {
		const state = fixture(); let pushes = 0;
		const fetcher: typeof fetch = async target => { if (String(target).endsWith("/info")) return response(info); if (String(target).includes("/view?")) return response(state); pushes++; throw new Error("unexpected push"); };
		const service = createHttpDataService(url, store(), { fetch: fetcher, lock }); await service.profiles.listProfiles(); await expect(service.profiles.updateProfile(7, { name: "Draft" })).rejects.toThrow("versionConflict");
		state.snapshot.aggregates[0]!.version = 2; state.snapshot.identities[0]!.version = 2; await service.profiles.listProfiles(); await expect(service.profiles.updateProfile(7, { name: "Old draft" }, 1)).rejects.toThrow("versionConflict"); expect(pushes).toBe(0);
	});
	it("fails before any push if the journal cannot be written", async () => {
		let pushes = 0; const fetcher: typeof fetch = async target => { if (String(target).endsWith("/info")) return response(info); if (String(target).includes("/view?")) return response(fixture()); pushes++; throw new Error("unexpected push"); };
		const service = createHttpDataService(url, { ...store(), setItem: () => { throw new Error("quota"); } }, { fetch: fetcher, lock }); await expect(service.profiles.createProfile({ name: "New", dailyCaloriesTarget: 1000 })).rejects.toThrow("quota"); expect(pushes).toBe(0);
	});
	it("keeps a confirmed receipt fenced across restart when refreshing fails; retry does not push again", async () => {
		const journal = store(); let state = fixture(), pushes = 0, reads = 0, failRead = true;
		const fetcher: typeof fetch = async (target, init) => {
			if (String(target).endsWith("/info")) return response(info);
			if (String(target).includes("/view?")) { reads++; if (reads > 1 && failRead) throw new Error("offline"); return response(state); }
			pushes++; const batch = JSON.parse(String(init!.body)), op = batch.operations[0]; state = { snapshot: snapshot([{ entity: "profiles", id: op.entityUuid, version: 1, deletedAt: null, data: op.payload }], "1"), viewIds: [{ entity: "profiles", uuid: op.entityUuid, id: 12 }] };
			return response({ ...binding, batchId: batch.batchId, cursor: "1", operations: [{ operationId: op.operationId, entity: op.entity, entityUuid: op.entityUuid, serverRevision: 1 }], changes: [{ entity: op.entity, entityUuid: op.entityUuid, serverRevision: 1 }] });
		};
		const service = createHttpDataService(url, journal, { fetch: fetcher, lock }); await expect(service.profiles.createProfile({ name: "Committed", dailyCaloriesTarget: 1000 })).rejects.toThrow("network"); expect(service.hasPendingWrite()).toBe(true);
		failRead = false; const restarted = createHttpDataService(url, journal, { fetch: fetcher, lock }); await restarted.retryPendingWrite(); expect(pushes).toBe(1); expect((await restarted.profiles.listProfiles())[0]!.id).toBe(12); expect(restarted.hasPendingWrite()).toBe(false);
	});
	it("does not replace a malformed journal", async () => {
		const journal = store(); journal.setItem(`munchling:web-write:${url}`, "broken"); const service = createHttpDataService(url, journal, { lock }); expect(() => service.hasPendingWrite()).toThrow("writeJournalInvalid"); await expect(service.retryPendingWrite()).rejects.toThrow("writeJournalInvalid"); expect(journal.getItem(`munchling:web-write:${url}`)).toBe("broken");
	});
	it("uses a cross-tab exclusive lock before altering the shared journal", async () => {
		const journal = store(); let held = false, pushes = 0;
		const exclusive: WebWriteLock = { run: async (_key, action) => { if (held) throw new SyncClientError("unconfirmedUpload"); held = true; try { return await action(); } finally { held = false; } } };
		let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
		const fetcher: typeof fetch = async target => { if (String(target).endsWith("/info")) return response(info); if (String(target).includes("/view?")) return response(fixture()); pushes++; await wait; throw new Error("lost"); };
		const a = createHttpDataService(url, journal, { fetch: fetcher, lock: exclusive }), b = createHttpDataService(url, journal, { fetch: fetcher, lock: exclusive }); await Promise.all([a.profiles.listProfiles(), b.profiles.listProfiles()]);
		const first = a.profiles.createProfile({ name: "A", dailyCaloriesTarget: 1000 }); while (!pushes) await new Promise(resolve => setTimeout(resolve, 1)); const saved = journal.getItem(`munchling:web-write:${url}`); await expect(b.profiles.createProfile({ name: "B", dailyCaloriesTarget: 1000 })).rejects.toThrow("unconfirmedUpload"); expect(journal.getItem(`munchling:web-write:${url}`)).toBe(saved); release(); await expect(first).rejects.toThrow("network"); expect(pushes).toBe(1);
	});
});
