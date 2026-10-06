import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { request } from "node:http";
import type { ServerDatabase } from "../../server/database/connection";
import type { ServerBinding, ServerInfo, SnapshotPage, ChangePage } from "../../shared/domain/protocol";
import type { ServerWriteBatch } from "../../shared/domain/server";
import { createUuid } from "../../shared/domain/sync";
import { createSyncHttpClient } from "../../app/utils/sync/http";
import { newDatabase, resetDatabase, testConfig } from "./helpers";
import { createTestDatabase } from "../helpers/sqlite";
import { createSnapshotStaging } from "../../app/utils/sync/staging";
import { createRemoteReceiver } from "../../app/utils/sync/apply";
import { createSyncQueue } from "../../app/utils/database/outbox";
import { createSyncDecisions } from "../../app/utils/sync/decisions";
import { fetchDecisionProof } from "../../app/utils/sync/proof";
const profile = (name = "HTTP 🥗") => ({ id: createUuid(), name, daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: "2026-10-05T12:00:00.000Z", updated_at: null });

describe("built Nitro sync HTTP API", () => {
	let db: ServerDatabase, child: ChildProcess, base: string, binding: ServerBinding, logs = "";
	const headers = { "x-munchling-protocol": "1", "content-type": "application/json" };
	const query = (extra: Record<string, string> = {}) => new URLSearchParams({ ...binding, ...extra }).toString();
	const post = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${base}/api/sync/${path}`, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
	const batch = (p = profile(), baseRevision = 0): ServerWriteBatch => ({ ...binding, batchId: createUuid(), operations: [{ operationId: createUuid(), entity: "profiles", entityUuid: p.id, baseRevision, operation: "upsert", payload: p }] });
	async function raw(headers: Record<string, string>, body?: Buffer) {
		return new Promise<{ status: number; text: string }>((resolve, reject) => {
			const req = request(`${base}/api/sync/push`, { method: "POST", headers }, (res) => { let text = ""; res.on("data", (value) => { text += String(value); }); res.on("end", () => resolve({ status: res.statusCode!, text })); });
			req.on("error", reject); req.end(body);
		});
	}
	beforeAll(async () => {
		db = newDatabase(); await resetDatabase(db, false);
		const socket = createServer(); await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve)); const address = socket.address(); if (!address || typeof address === "string") throw new Error("Missing HTTP port"); const port = address.port; await new Promise<void>((resolve) => socket.close(() => resolve())); base = `http://127.0.0.1:${port}`;
		const config = testConfig(); child = spawn(process.execPath, [".output/server/index.mjs"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env: {
			...process.env, NITRO_HOST: "127.0.0.1", NITRO_PORT: String(port), NUXT_SERVER_ENABLED: "true", NUXT_MARIA_DB_CONNECTION_LIMIT: "3", NUXT_SYNC_PUBLIC_ORIGIN: base, NUXT_SYNC_ALLOWED_ORIGINS: "capacitor://localhost,http://localhost",
			NUXT_MARIA_DB_HOST: config.host, NUXT_MARIA_DB_PORT: String(config.port), NUXT_MARIA_DB_USER: config.user, NUXT_MARIA_DB_PASSWORD: config.password, NUXT_MARIA_DB_DATABASE: config.database,
		} }); child.stdout?.on("data", (value) => { logs += String(value); }); child.stderr?.on("data", (value) => { logs += String(value); });
		for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error("Backend exited during startup"); try { if ((await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(1000) })).status === 200) return; } catch { /* waiting */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
		throw new Error("Backend startup timed out");
	});
	beforeEach(async () => { await resetDatabase(db); const info: ServerInfo = await (await fetch(`${base}/api/sync/info`)).json(); binding = { serverInstanceId: info.serverInstanceId, serverEpoch: info.serverEpoch }; });
	afterAll(async () => {
		if (child && child.exitCode === null && child.signalCode === null) { const exited = new Promise<void>((resolve) => child.once("exit", () => resolve())); child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 6000); try { await exited; } finally { clearTimeout(timer); } }
		if (db) await db.close();
	});
	it("uses the production client decoder against actual Nitro responses", async () => {
		const client = createSyncHttpClient(base); expect((await client.info()).serverEpoch).toBe(binding.serverEpoch);
		const command = batch(); const receipt = await client.push(command); expect(await client.push(command)).toEqual(receipt);
		const snapshot = await client.startSnapshot(binding); expect(snapshot.aggregates[0]!.data).toEqual(command.operations[0]!.payload);
		expect((await client.changes(binding, "0")).batches[0]!.changes[0]!.aggregate.id).toBe(command.operations[0]!.entityUuid);
		await client.releaseSnapshot(snapshot);
	});
	it("stages and atomically applies real HTTP replies across independent SQLite clients and restart", async () => {
		const a = await createTestDatabase(), b = await createTestDatabase(); let reopened: typeof a | undefined;
		try {
			const client = createSyncHttpClient(base), p = profile(); await client.push(batch(p)); const first = await client.startSnapshot(binding);
			for (const local of [a, b]) {
				const store = createSnapshotStaging(local.database), epoch = (await store.state()).localEpoch;
				await store.begin(epoch, base, first);
				for (let index = 1; index < first.pageCount; index++) await store.save(await client.snapshotPage(first, index));
				expect((await createRemoteReceiver(local.database).adoptSnapshot(epoch)).status).toBe("applied");
			}
			await client.releaseSnapshot(first); const aId = (await a.service.profiles.listProfiles())[0]!.id;
			await a.service.profiles.updateProfile(aId, { name: "Offline edit" }); const pending = await createSyncQueue(a.database).list(); await client.push(batch({ ...p, name: "Server edit" }, 1));
			const changes = await client.changes(binding, first.cursor);
			for (const local of [a, b]) {
				const context = { ...binding, localEpoch: (await createSnapshotStaging(local.database).state()).localEpoch, url: base, cursor: first.cursor };
				expect((await createRemoteReceiver(local.database).applyPage(context, changes))[0]!.status).toBe(local === a ? "blocked" : "applied");
				expect(await createRemoteReceiver(local.database).applyPage(context, changes)).toEqual([]);
			}
			expect((await b.service.profiles.listProfiles())[0]!.name).toBe("Server edit"); expect(await createSyncQueue(b.database).list()).toEqual([]);
			reopened = await createTestDatabase({ bytes: a.exportBytes() }); expect((await reopened.service.profiles.listProfiles())[0]!.name).toBe("Offline edit"); expect(await createSyncQueue(reopened.database).list()).toEqual(pending); expect(await createRemoteReceiver(reopened.database).conflicts()).toHaveLength(1);
		} finally { reopened?.close(); a.close(); b.close(); }
	});
	it("rechecks manual decisions against real server cuts and preserves optimistic concurrency after choosing local", async () => {
		const local = await createTestDatabase();
		try {
			const client = createSyncHttpClient(base), p = profile(); await client.push(batch(p)); const first = await client.startSnapshot(binding), store = createSnapshotStaging(local.database), epoch = (await store.state()).localEpoch;
			await store.begin(epoch, base, first); await client.releaseSnapshot(first);
			const decisions = createSyncDecisions(local.database, async () => {}), initial = await decisions.initialPreview(); await decisions.initialCommit(initial.token, "combine", await fetchDecisionProof(base, binding));
			await local.service.profiles.updateProfile((await local.service.profiles.listProfiles())[0]!.id, { name: "Offline winner" }); const before = await createSyncQueue(local.database).list();
			await client.push(batch({ ...p, name: "Server v2" }, 1)); await createRemoteReceiver(local.database).applyPage({ ...binding, localEpoch: epoch, url: base, cursor: first.cursor }, await client.changes(binding, first.cursor));
			const preview = await decisions.conflictPreview(await fetchDecisionProof(base, binding));
			await client.push(batch({ ...p, name: "Server v3" }, 2)); await expect(decisions.resolve(preview.token, { [p.id]: "local" }, await fetchDecisionProof(base, binding))).rejects.toThrow("previewChanged"); expect(await createSyncQueue(local.database).list()).toEqual(before);
			const latest = await decisions.conflictPreview(await fetchDecisionProof(base, binding)); await decisions.resolve(latest.token, { [p.id]: "local" }, await fetchDecisionProof(base, binding));
			const queued = await createSyncQueue(local.database).list(); expect(queued[0]!.baseRevision).toBe(3); expect(queued[0]!.payload.name).toBe("Offline winner");
			await client.push(batch({ ...p, name: "Another editor v4" }, 3));
			const attempt: ServerWriteBatch = { ...binding, batchId: queued[0]!.batchId, operations: queued.map(op => ({ operationId: op.operationId, entity: op.entity, entityUuid: op.entityUuid, baseRevision: op.baseRevision, operation: op.operation, payload: op.payload })) };
			await expect(client.push(attempt)).rejects.toMatchObject({ code: "versionConflict" }); expect(await createSyncQueue(local.database).list()).toEqual(queued);
			expect((await fetchDecisionProof(base, binding))[0]!.aggregates[0]!.data!.name).toBe("Another editor v4");
		} finally { local.close(); }
	});
	it("negotiates info, pushes/replays and pulls exact confirmed data without duplicate operations", async () => {
		const infoResponse = await fetch(`${base}/api/sync/info`); expect(infoResponse.status).toBe(200); expect(infoResponse.headers.get("cache-control")).toBe("no-store"); expect(await infoResponse.json()).toMatchObject({ protocolVersion: 1, schemaVersion: 2, capabilities: { authentication: "none" } });
		const command = batch(); const first = await post("push", command); expect(first.status).toBe(200); const receipt = await first.json(); expect(await (await post("push", command)).json()).toEqual(receipt);
		const delta: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`, { headers })).json(); expect(delta).toMatchObject({ cursor: "1", hasMore: false }); expect(delta.batches[0]!.changes[0]!.aggregate.data).toEqual(command.operations[0]!.payload);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_operations"))).toEqual([{ n: 1 }]);
	});
	it("lets two independent clients download the same cut, edit, conflict and explicitly re-submit", async () => {
		const p = profile(); await post("push", batch(p));
		const a: SnapshotPage = await (await post("snapshots", binding)).json(); const b: SnapshotPage = await (await post("snapshots", binding)).json(); expect(a.aggregates).toEqual(b.aggregates);
		const editA = batch({ ...p, name: "Client A" }, 1); expect((await post("push", editA)).status).toBe(200);
		const editB = batch({ ...p, name: "Client B" }, 1); const conflict = await post("push", editB); expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ error: { code: "versionConflict", resync: false, retryable: false, current: [{ id: p.id, version: 2, data: { name: "Client A" } }] } });
		const resolved = batch({ ...p, name: "Client B" }, 2); expect((await post("push", resolved)).status).toBe(200);
		const read: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: a.cursor })}`, { headers })).json(); expect(read.batches).toHaveLength(2); expect(read.batches[1]!.changes[0]!.aggregate.data!.name).toBe("Client B");
	});
	it("resumes immutable paged snapshots and releases their storage idempotently", async () => {
		const a = batch(profile("a".repeat(70_000))), b = batch(profile("b".repeat(70_000))); await post("push", a); await post("push", b);
		const first: SnapshotPage = await (await post("snapshots", { ...binding, targetBytes: 65_536 })).json(); expect(first.nextPage).not.toBeNull();
		const edit = batch({ ...a.operations[0]!.payload, name: "Changed" } as ReturnType<typeof profile>, 1); await post("push", edit);
		const second: SnapshotPage = await (await fetch(`${base}/api/sync/snapshots/${first.snapshotId}?${query({ page: "1" })}`, { headers })).json(); expect(second.cursor).toBe(first.cursor); expect(second.aggregates[0]!.data!.name).not.toBe("Changed");
		const url = `${base}/api/sync/snapshots/${first.snapshotId}?${query()}`; expect((await fetch(url, { method: "DELETE", headers })).status).toBe(200); expect((await fetch(url, { method: "DELETE", headers })).status).toBe(200);
		expect((await fetch(`${url}&page=0`, { headers })).status).toBe(410);
	});
	it("serializes simultaneous edits from separate clients without silent overwrites", async () => {
		const p = profile(); await post("push", batch(p));
		const responses = await Promise.all([post("push", batch({ ...p, name: "A" }, 1)), post("push", batch({ ...p, name: "B" }, 1))]);
		expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
		const changes: ChangePage = await (await fetch(`${base}/api/sync/changes?${query({ cursor: "1" })}`, { headers })).json(); expect(changes.batches).toHaveLength(1); expect(changes.batches[0]!.changes[0]!.aggregate.version).toBe(2);
	});
	it("returns explicit dependency/version conflicts and tombstones for ordinary deletions", async () => {
		const p = profile(); await post("push", batch(p));
		const preview = await fetch(`${base}/api/sync/deletion-preview?${query({ entity: "profiles", id: p.id })}`, { headers }); expect(await preview.json()).toMatchObject({ root: { id: p.id, version: 1 }, dependents: [] });
		const del = batch(p, 1); del.operations[0]!.operation = "delete"; del.operations[0]!.payload = { id: p.id };
		expect((await post("push", del)).status).toBe(200); const stale = await post("push", batch({ ...p, name: "Resurrect?" }, 1)); expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ error: { current: [{ version: 2, data: null }] } });
	});
	it("demands protocol negotiation and controlled resync for unknown cursors/epochs", async () => {
		const mismatch = await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`); expect(mismatch.status).toBe(426); expect(await mismatch.json()).toMatchObject({ error: { code: "protocolMismatch" } });
		const cursor = await fetch(`${base}/api/sync/changes?${query({ cursor: "999" })}`, { headers }); expect(cursor.status).toBe(409); expect(await cursor.json()).toMatchObject({ error: { code: "cursorInvalid", resync: true } });
		const changed = await post("snapshots", { ...binding, serverEpoch: createUuid() }); expect(changed.status).toBe(409); expect(await changed.json()).toMatchObject({ error: { code: "serverChanged", resync: true } });
	});
	it("allows explicitly trusted native/browser origins and rejects hostile/null origins and rebinding hosts", async () => {
		for (const origin of [base, "capacitor://localhost", "http://localhost"]) { const response = await fetch(`${base}/api/sync/info`, { headers: { origin } }); expect(response.status).toBe(200); expect(response.headers.get("access-control-allow-origin")).toBe(origin); expect(response.headers.get("access-control-allow-credentials")).toBeNull(); }
		for (const origin of ["https://evil.invalid", "null"]) expect((await post("push", batch(), { origin })).status).toBe(403);
		const denied = await raw({ ...headers, host: "evil.invalid" }, Buffer.from(JSON.stringify(batch()))); expect(denied.status).toBe(403);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_batches"))).toEqual([{ n: 0 }]);
	});
	it("serves restricted native preflight but rejects extra headers/methods", async () => {
		const h = { origin: "capacitor://localhost", "access-control-request-method": "POST", "access-control-request-headers": "Content-Type, X-Munchling-Protocol" };
		const good = await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: h }); expect(good.status).toBe(204); expect(good.headers.get("access-control-allow-origin")).toBe(h.origin);
		expect((await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: { ...h, "access-control-request-headers": "authorization" } })).status).toBe(403);
		expect((await fetch(`${base}/api/sync/push`, { method: "OPTIONS", headers: { ...h, "access-control-request-method": "PUT" } })).status).toBe(403);
	});
	it("rejects non-JSON, malformed UTF-8/JSON, compressed and oversized bodies before writing", async () => {
		expect((await post("push", batch(), { "content-type": "text/plain" })).status).toBe(415);
		expect((await post("push", batch(), { "content-encoding": "gzip" })).status).toBe(415);
		expect((await raw(headers, Buffer.from("{"))).status).toBe(400); expect((await raw(headers, Buffer.from([0xc3, 0x28]))).status).toBe(400);
		expect((await raw({ ...headers, "content-length": String(26 * 1024 * 1024) })).status).toBe(413);
		expect((await raw(headers, Buffer.alloc(25 * 1024 * 1024 + 1, 32))).status).toBe(413);
		expect(await db.withConnection((sql) => sql.query("SELECT COUNT(*) AS n FROM write_batches"))).toEqual([{ n: 0 }]);
	});
	it("sanitizes driver/validation failures and logs no names, payloads or credentials", async () => {
		const command = batch(profile("PRIVATE-PROFILE-NAME")); delete command.operations[0]!.payload.daily_calories_target;
		const invalid = await post("push", command); expect(invalid.status).toBe(422); const content = await invalid.text(); expect(content).not.toContain("PRIVATE-PROFILE-NAME");
		await db.withConnection((sql) => sql.write("DROP TABLE change_log")); const response = await fetch(`${base}/api/sync/changes?${query({ cursor: "0" })}`, { headers }); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: { code: "DB_READ_FAILED", retryable: true } });
		expect(logs).not.toContain("PRIVATE-PROFILE-NAME"); expect(logs).not.toContain(testConfig().password); expect(logs).not.toContain("SELECT ");
	});
});
