import { normalizeWriteBatch } from "../../../shared/domain/server-validation";
import { replyAggregate, replyChanges, replyInfo, replyReceipt, replySnapshot, SyncClientError, validated, wireCursor } from "../../../shared/domain/replies";
import { syncLimits, syncProtocolVersion, type ServerBinding, type SnapshotPage } from "../../../shared/domain/protocol";
import { replyWebState } from "../../../shared/domain/web";
import type { ServerWriteBatch } from "../../../shared/domain/server";

const errorCodes = new Set(["historyConflict", "versionConflict", "dependencyConflict", "identityConflict", "idempotencyConflict", "serverChanged", "cursorInvalid", "snapshotExpired", "snapshotBusy", "snapshotLimit", "batchTooLarge", "protocolMismatch", "invalidRequest", "DB_READ_FAILED", "DB_WRITE_FAILED", "DB_UNAVAILABLE", "API_NOT_CONFIGURED", "ORIGIN_DENIED", "JSON_REQUIRED", "BODY_TOO_LARGE", "REQUEST_TIMEOUT", "REQUEST_ABORTED", "INVALID_JSON", "required", "invalidType", "invalidNumber", "invalidDate", "invalidSource", "duplicate", "reference", "cycle", "backupFormat", "backupLimit"]);
export function syncServerUrl(value: string): string {
	try { const url = new URL(value); if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error(); return url.origin; }
	catch { throw new SyncClientError("invalidServerUrl"); }
}
export function createSyncHttpClient(address: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
	const base = syncServerUrl(address), fetcher = options.fetch ?? globalThis.fetch.bind(globalThis), timeout = options.timeoutMs ?? 30_000;
	if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000) throw new SyncClientError("invalidTimeout");
	async function request(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<unknown> {
		const controller = new AbortController(); let timedOut = false;
		const cancelled = () => controller.abort(); signal?.addEventListener("abort", cancelled, { once: true }); if (signal?.aborted) controller.abort();
		const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		const abort = new Promise<never>((_, reject) => {
			const rejectAbort = () => reject(new SyncClientError(timedOut ? "timeout" : "cancelled", false, timedOut));
			controller.signal.addEventListener("abort", rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort();
		});
		try {
			return await Promise.race([abort, (async () => {
				const text = body === undefined ? undefined : JSON.stringify(body);
				if (text !== undefined && new TextEncoder().encode(text).byteLength > syncLimits.pushBytes) throw new SyncClientError("requestTooLarge");
				if (controller.signal.aborted) throw new SyncClientError("cancelled");
				const response = await fetcher(`${base}/api/sync/${path}`, { method, body: text, headers: { "X-Munchling-Protocol": String(syncProtocolVersion), ...(text === undefined ? {} : { "Content-Type": "application/json" }) }, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal });
				if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new SyncClientError("invalidResponse");
				const maximum = syncLimits.batchBytes + 64 * 1024; // Conflicts can contain full aggregates too.
				const declared = response.headers.get("content-length"); if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new SyncClientError("responseTooLarge");
				reader = response.body?.getReader(); if (!reader) throw new SyncClientError("invalidResponse");
				const chunks: Uint8Array[] = []; let size = 0;
				while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > maximum) throw new SyncClientError("responseTooLarge"); chunks.push(part.value); }
				const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
				let value: unknown; try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new SyncClientError("invalidResponse"); }
				if (!response.ok) {
					throw validated(() => {
						const error = (value as { error?: { code: string; resync: boolean; retryable: boolean; current?: unknown[] } })?.error;
						if (!error || !errorCodes.has(error.code) || typeof error.resync !== "boolean" || typeof error.retryable !== "boolean" || error.current !== undefined && !Array.isArray(error.current)) throw new SyncClientError("invalidResponse");
						const ids = new Set<string>(); const current = (error.current ?? []).map((root) => replyAggregate(root, ids));
						return new SyncClientError(error.code, error.resync, error.retryable, current, response.status);
					});
				}
				return value;
			})()]);
		} catch (error) { if (error instanceof SyncClientError) throw error; throw new SyncClientError(timedOut ? "timeout" : signal?.aborted ? "cancelled" : "network", false, !signal?.aborted); }
		finally { clearTimeout(timer); signal?.removeEventListener("abort", cancelled); controller.abort(); if (reader) { void reader.cancel().catch(() => {}); } }
	}
	const query = (binding: ServerBinding, extra: Record<string, string> = {}) => new URLSearchParams({ serverInstanceId: binding.serverInstanceId, serverEpoch: binding.serverEpoch, ...extra }).toString();
	const client = {
		url: base,
		info: async (signal?: AbortSignal) => replyInfo(await request("info", "GET", undefined, signal)),
		webState: async (binding: ServerBinding, signal?: AbortSignal) => replyWebState(await request(`view?${query(binding)}`, "GET", undefined, signal), binding),
		push: async (input: ServerWriteBatch, signal?: AbortSignal) => { const batch = normalizeWriteBatch(input); return replyReceipt(await request("push", "POST", batch, signal), batch); },
		changes: async (binding: ServerBinding, cursor: string, signal?: AbortSignal) => { wireCursor(cursor); return replyChanges(await request(`changes?${query(binding, { cursor })}`, "GET", undefined, signal), binding, cursor); },
		startSnapshot: async (binding: ServerBinding, signal?: AbortSignal) => replySnapshot(await request("snapshots", "POST", binding, signal), binding, 0),
		snapshotPage: async (previous: SnapshotPage, page: number, signal?: AbortSignal) => replySnapshot(await request(`snapshots/${previous.snapshotId}?${query(previous, { page: String(page) })}`, "GET", undefined, signal), previous, page, previous),
		releaseSnapshot: async (snapshot: SnapshotPage, signal?: AbortSignal) => { const result = await request(`snapshots/${snapshot.snapshotId}?${query(snapshot)}`, "DELETE", undefined, signal); if (!result || (result as { released?: boolean }).released !== true) throw new SyncClientError("invalidResponse"); },
	};
	return { ...client, async *snapshotPages(binding: ServerBinding, signal?: AbortSignal, resume?: SnapshotPage) {
		let page = resume ? replySnapshot(resume, binding, resume.page) : await client.startSnapshot(binding, signal);
		const first = page, roots = new Set<string>(), identities = new Set<string>(); let size = 0, records = 0;
		while (true) {
			validated(() => {
				for (const root of page.aggregates) replyAggregate(root, roots);
				for (const identity of page.identities) { if (identities.has(identity.uuid)) throw new SyncClientError("invalidResponse"); identities.add(identity.uuid); }
			});
			size += new TextEncoder().encode(JSON.stringify({ aggregates: page.aggregates, identities: page.identities })).byteLength; records += page.aggregates.length + page.identities.length;
			if (size > syncLimits.maxSnapshotBytes || records > syncLimits.maxSnapshotRecords) throw new SyncClientError("responseTooLarge");
			yield page; // Consumer MUST stage, not apply partial referential graphs.
			if (page.nextPage === null) return;
			page = await client.snapshotPage(first, page.nextPage, signal);
		}
	} };
}
