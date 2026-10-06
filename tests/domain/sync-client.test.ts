import { describe, expect, it, vi } from "vitest";
import { createSyncHttpClient, syncServerUrl } from "../../app/utils/sync/http";
import { replyChanges, replyReceipt, replySnapshot } from "../../shared/domain/replies";
import { syncLimits } from "../../shared/domain/protocol";
import { createUuid } from "../../shared/domain/sync";
import type { ServerWriteBatch } from "../../shared/domain/server";
const binding = { serverInstanceId: createUuid(), serverEpoch: createUuid() };
const date = "2026-10-05T12:00:00.000Z";
const id = createUuid();
const payload = { id, name: "Private Name", daily_calories_target: 2000, daily_protein_target: null, daily_carbs_target: null, daily_fat_target: null, daily_sugar_target: null, daily_fiber_target: null, daily_salt_target: null, created_at: date, updated_at: null };
const root = { entity: "profiles", id, version: 1, deletedAt: null, data: payload };
const request: ServerWriteBatch = { ...binding, batchId: createUuid(), operations: [{ operationId: createUuid(), entity: "profiles", entityUuid: id, baseRevision: 0, operation: "upsert", payload }] };
const receipt = { ...binding, batchId: request.batchId, cursor: "1", operations: [{ operationId: request.operations[0]!.operationId, entity: "profiles", entityUuid: id, serverRevision: 1 }], changes: [{ entity: "profiles", entityUuid: id, serverRevision: 1 }] };
const page = { ...binding, protocolVersion: 1, snapshotId: createUuid(), cursor: "1", expiresAt: date, page: 0, pageCount: 1, nextPage: null, aggregates: [root], identities: [{ uuid: id, entity: "profiles", aggregateUuid: id, version: 1, deletedAt: null }] };
const delta = { ...binding, protocolVersion: 1, fromCursor: "0", cursor: "1", highWaterCursor: "1", hasMore: false, batches: [{ batchId: request.batchId, firstCursor: "1", lastCursor: "1", changes: [{ cursor: "1", aggregate: root }] }] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
describe("safe protocol client", () => {
	it.each(["file:///tmp", "https://user:secret@example.org", "https://example.org/prefix", "https://example.org?q=1", "https://example.org#x"])("rejects unsafe/ambiguous address %s", (url) => expect(() => syncServerUrl(url)).toThrow("invalidServerUrl"));
	it("normalizes HTTPS origin and performs no requests on construction", () => { const fetch = vi.fn(); expect(createSyncHttpClient("https://EXAMPLE.org:443/", { fetch }).url).toBe("https://example.org"); expect(fetch).not.toHaveBeenCalled(); });
	it("sends frozen normalized requests without credentials or redirects, preserving IDs on caller retry", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => json(receipt)); const client = createSyncHttpClient("https://example.org", { fetch });
		expect(await client.push(request)).toEqual(receipt); expect(await client.push(request)).toEqual(receipt);
		expect(fetch.mock.calls[0]![0]).toBe(fetch.mock.calls[1]![0]);
		expect(fetch.mock.calls[0]![1]!.body).toBe(fetch.mock.calls[1]![1]!.body);
		expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: "omit", redirect: "error", cache: "no-store" });
	});
	it("does not put snapshot content or other extra binding properties into query strings", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ released: true })); await createSyncHttpClient("https://example.org", { fetch }).releaseSnapshot(page as never);
		const url = String(fetch.mock.calls[0]![0]); expect(url).not.toContain("Private"); expect(url).not.toContain("aggregates"); expect(new URL(url).searchParams.size).toBe(2);
	});
	it.each(["operations", "changes"])("rejects missing confirmation section %s before acknowledging", (field) => { const bad = structuredClone(receipt) as Record<string, unknown>; delete bad[field]; expect(() => replyReceipt(bad, request)).toThrow("invalidResponse"); });
	it("rejects confirmations for wrong operations, stale revisions, duplicate IDs and changed server", () => {
		for (const mutate of [(v: typeof receipt) => { v.operations[0]!.operationId = createUuid(); }, (v: typeof receipt) => { v.operations[0]!.serverRevision = 0; }, (v: typeof receipt) => { v.operations.push(v.operations[0]!); }]) { const bad = structuredClone(receipt); mutate(bad); expect(() => replyReceipt(bad, request)).toThrow("invalidResponse"); }
		expect(() => replyReceipt({ ...receipt, serverEpoch: createUuid() }, request)).toThrow("serverChanged");
	});
	it("validates full payloads, child ownership and stable snapshot metadata", () => {
		expect(replySnapshot(structuredClone(page), binding, 0)).toEqual(page);
		expect(() => replySnapshot({ ...page, cursor: "2" }, binding, 0, page as never)).toThrow("invalidResponse");
		expect(() => replySnapshot({ ...page, aggregates: [{ ...root, data: { ...payload, daily_calories_target: -1 } }] }, binding, 0)).toThrow("invalidResponse");
		expect(() => replySnapshot({ ...page, identities: [page.identities[0], page.identities[0]] }, binding, 0)).toThrow("invalidResponse");
	});
	it("rejects skipped cursors, forged high-water advancement and incomplete groups", () => {
		expect(replyChanges(structuredClone(delta), binding, "0")).toEqual(delta);
		for (const bad of [{ ...delta, cursor: "2" }, { ...delta, batches: [] }, { ...delta, hasMore: true }, { ...delta, batches: [{ ...delta.batches[0], firstCursor: "2" }] }]) expect(() => replyChanges(bad, binding, "0")).toThrow("invalidResponse");
	});
	it("streams one immutable snapshot cut without releasing it before a consumer commits", async () => {
		const first = { ...page, pageCount: 2, nextPage: 1, identities: [] }, second = { ...page, page: 1, pageCount: 2, nextPage: null, aggregates: [] };
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json(second)); const received = [];
		for await (const part of createSyncHttpClient("https://example.org", { fetch }).snapshotPages(binding)) received.push(part);
		expect(received).toEqual([first, second]); expect(fetch).toHaveBeenCalledTimes(2);
	});
	it("rejects duplicate roots across snapshot pages before a completed download can be accepted", async () => {
		const first = { ...page, pageCount: 2, nextPage: 1 }, second = { ...page, page: 1, pageCount: 2, nextPage: null };
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(json(first)).mockResolvedValueOnce(json(second)); const client = createSyncHttpClient("https://example.org", { fetch });
		await expect((async () => { for await (const _part of client.snapshotPages(binding)) { /* staging only */ } })()).rejects.toMatchObject({ code: "invalidResponse" });
	});
	it("returns typed conflicts, without automatic retry/rebase", async () => {
		const fetch = vi.fn(async () => json({ error: { code: "versionConflict", resync: false, retryable: false, current: [root] } }, 409)); const client = createSyncHttpClient("https://example.org", { fetch });
		await expect(client.push(request)).rejects.toMatchObject({ code: "versionConflict", status: 409, current: [root], retryable: false }); expect(fetch).toHaveBeenCalledTimes(1);
	});
	it("rejects HTML, invalid UTF-8, malformed JSON and oversized declared bodies", async () => {
		const responses = [new Response("<html>", { headers: { "content-type": "text/html" } }), new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-type": "application/json" } }), new Response("{", { headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "application/json", "content-length": String(syncLimits.batchBytes + 100_000) } })];
		for (const response of responses) await expect(createSyncHttpClient("https://example.org", { fetch: async () => response }).info()).rejects.toMatchObject({ name: "SyncClientError" });
	});
	it("enforces deadlines even on a non-cooperating fetch implementation", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {})); await expect(createSyncHttpClient("https://example.org", { fetch, timeoutMs: 10 }).info()).rejects.toMatchObject({ code: "timeout", retryable: true });
	});
	it("honors pre-cancellation without sending and sanitizes network errors", async () => {
		const controller = new AbortController(); controller.abort(); const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error("Private Name password"); });
		const client = createSyncHttpClient("https://example.org", { fetch }); await expect(client.info(controller.signal)).rejects.toMatchObject({ code: "cancelled" }); expect(fetch).not.toHaveBeenCalled(); await expect(client.info()).rejects.toMatchObject({ code: "network", message: "network" });
	});
});
