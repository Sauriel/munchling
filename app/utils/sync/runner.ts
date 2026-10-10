import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { acknowledgeSyncBatch } from "../database/outbox";
import { normalizeWriteBatch } from "../../../shared/domain/server-validation";
import { replyReceipt, SyncClientError } from "../../../shared/domain/replies";
import type { ServerWriteBatch } from "../../../shared/domain/server";
import type { SyncAggregate } from "../../../shared/domain/sync";
import { createSyncHttpClient } from "./http";
import { checkLocalContext, receiveState, storedJson, type ReceiveState } from "./staging";
import { createRemoteReceiver } from "./apply";

type Context = ReceiveState & { url: string; cursor: string };
type Journal = { local_epoch: string; server_url: string; request: string; receipt: string | null };
type OperationRow = { batch_id: string; operation_id: string; entity: SyncAggregate; entity_uuid: string; base_revision: number; operation: "upsert" | "delete"; payload: string; status: string };
const running = new WeakSet<SqlDatabase>();
export type SyncRunResult = { uploaded: number; received: number; pending: number; blocked: number };
export async function syncStatus(db: SqlDatabase) {
	return db.transaction(async sql => ({ state: await receiveState(sql),
		pending: (await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM sync_outbox;"))[0]!.n,
		uncertain: (await sql.query("SELECT id FROM sync_upload UNION SELECT 1 FROM sync_outbox WHERE status='inflight';")).length > 0,
		blocked: (await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM sync_inbox WHERE status='blocked';"))[0]!.n }));
}
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new SyncClientError("cancelled"); }
async function check(sql: SqlExecutor, context: Context) {
	const state = await receiveState(sql); checkLocalContext(state, context.localEpoch, context.url, context);
	if (state.url === null || state.cursor === null) throw new SyncClientError("notInitialized");
	return state;
}
function batch(rows: OperationRow[], context: Context, device: string): ServerWriteBatch {
	return normalizeWriteBatch({ batchId: rows[0]!.batch_id, serverInstanceId: context.serverInstanceId, serverEpoch: context.serverEpoch, deviceId: device,
		operations: rows.map(row => ({ operationId: row.operation_id, entity: row.entity, entityUuid: row.entity_uuid, baseRevision: row.base_revision, operation: row.operation, payload: storedJson(row.payload) })) });
}
async function journal(sql: SqlExecutor, context: Context) {
	await check(sql, context);
	const row = (await sql.query<Journal>("SELECT * FROM sync_upload WHERE id=1;"))[0];
	if (!row) return null;
	if (row.local_epoch !== context.localEpoch || row.server_url !== context.url) throw new SyncClientError("localReset");
	let request: ServerWriteBatch;
	try { request = normalizeWriteBatch(storedJson(row.request)); } catch { throw new SyncClientError("writeJournalInvalid"); }
	if (request.serverInstanceId !== context.serverInstanceId || request.serverEpoch !== context.serverEpoch) throw new SyncClientError("serverChanged");
	const rows = await sql.query<OperationRow>("SELECT * FROM sync_outbox WHERE batch_id=? ORDER BY sequence;", [request.batchId]);
	if (!rows.length || rows.some(row => row.status !== "inflight") || JSON.stringify(batch(rows, context, request.deviceId!)) !== row.request) throw new SyncClientError("writeJournalInvalid");
	return { row, request };
}
function definitive(error: unknown) {
	return error instanceof SyncClientError && (error.status === 409 && ["versionConflict", "dependencyConflict", "identityConflict"].includes(error.code) || error.status === 422 && ["reference", "duplicate", "cycle"].includes(error.code));
}

// Construction/status never network, bind, enable, or upload.
// Exactly one run per shared SQLite facade, including component remounts.
export function createManualSyncRunner(db: SqlDatabase, options: Parameters<typeof createSyncHttpClient>[1] = {}) {
	return {
		status: () => syncStatus(db),
		sync: async (confirmed = false, signal?: AbortSignal, authorize?: () => Promise<boolean>): Promise<SyncRunResult> => {
			if (!confirmed) throw new SyncClientError("confirmSync");
			if (running.has(db)) throw new SyncClientError("syncBusy");
			running.add(db);
			const result = { uploaded: 0, received: 0, pending: 0, blocked: 0 };
			async function permission() {
				aborted(signal);
				if (authorize && !await authorize()) throw new SyncClientError('confirmSync');
				aborted(signal);
			}
			try {
				await permission(); const state = await db.transaction(receiveState);
				if (state.seeded) throw new SyncClientError("developmentSeeded");
				if (!state.url || state.cursor === null) throw new SyncClientError("notInitialized");
				const context: Context = { ...state, url: state.url, cursor: state.cursor }, client = createSyncHttpClient(context.url, options), receiver = createRemoteReceiver(db);
				async function pull() {
					for (let count = 0; count < 128; count++) {
						aborted(signal); const current = await db.transaction(sql => check(sql, context));
						await permission();
						const page = await client.changes(context, current.cursor!, signal);
						await permission();
						const outcomes = await receiver.applyPage({ ...context, cursor: current.cursor! }, page);
						result.received += outcomes.length;
						if (!page.hasMore) return;
					}
					throw new SyncClientError("moreWork");
				}
				async function send(saved: NonNullable<Awaited<ReturnType<typeof journal>>>) {
					if (saved.row.receipt === null) {
						try {
							await permission();
							const receipt = await client.push(saved.request, signal);
							await db.transaction(async sql => { const current = await journal(sql, context); if (!current || current.row.request !== saved.row.request) throw new SyncClientError("localReset"); await sql.run("UPDATE sync_upload SET receipt=? WHERE id=1;", [JSON.stringify(receipt)]); });
						} catch (error) {
							// Canonical transaction rejection proves non-commit. All other
							// errors retain exact request, bases and inflight ownership.
							if (definitive(error)) {
								await db.transaction(async sql => { const current = await journal(sql, context); if (!current || current.row.request !== saved.row.request || current.row.receipt !== null) throw new SyncClientError("localReset"); await sql.run("UPDATE sync_outbox SET status='pending' WHERE batch_id=?;", [saved.request.batchId]); await sql.run("DELETE FROM sync_upload;"); });
								try { await pull(); } catch { /* original rejection remains the actionable error */ }
							}
							throw error;
						}
					}
					await db.transaction(async sql => {
						const current = await journal(sql, context); if (!current || current.row.receipt === null) throw new SyncClientError("writeJournalInvalid");
						const receipt = replyReceipt(storedJson(current.row.receipt), current.request);
						await acknowledgeSyncBatch(sql, current.request.batchId, receipt.operations);
						await sql.run("DELETE FROM sync_upload;");
					});
					result.uploaded++;
				}
				// Settle uncertainty BEFORE pulling: our acknowledged predecessors
				// must not be mistaken for remote conflicts against newer drafts.
				const saved = await db.transaction(sql => journal(sql, context));
				// A receipt already saved locally can be acknowledged even if the
				// server is offline/restored now. It belongs to the OLD binding;
				// subsequent info still enforces explicit resync, never rebinds.
				if (saved && saved.row.receipt !== null) await send(saved);
				await permission();
				const info = await client.info(signal);
				if (info.serverInstanceId !== context.serverInstanceId || info.serverEpoch !== context.serverEpoch) throw new SyncClientError("serverChanged", true);
				if (saved && saved.row.receipt === null) await send(saved);
				if ((await syncStatus(db)).uncertain) throw new SyncClientError("unconfirmedUpload");
				await pull();
				for (let count = 0; count < 512; count++) {
					await permission();
					const next = await db.transaction(async sql => {
						await check(sql, context);
						if ((await sql.query("SELECT id FROM sync_inbox WHERE status='blocked' LIMIT 1;")).length || (await sql.query("SELECT uuid FROM sync_conflicts LIMIT 1;")).length) throw new SyncClientError("conflictsPending");
						if ((await sql.query("SELECT id FROM sync_upload UNION SELECT 1 FROM sync_outbox WHERE status='inflight';")).length) throw new SyncClientError("unconfirmedUpload");
						const first = (await sql.query<{ batch_id: string }>("SELECT batch_id FROM sync_outbox ORDER BY sequence LIMIT 1;"))[0]; if (!first) return null;
						const rows = await sql.query<OperationRow>("SELECT * FROM sync_outbox WHERE batch_id=? ORDER BY sequence;", [first.batch_id]);
						const device = (await sql.query<{ device_id: string }>("SELECT device_id FROM sync_state WHERE id=1;"))[0]!.device_id;
						const request = batch(rows, context, device);
						// No freshly fetched delete guards behind a prior confirmation:
						// queued cascade operations carry captured bases; unseen server
						// dependencies must cause canonical dependencyConflict.
						await sql.run("UPDATE sync_outbox SET status='inflight' WHERE batch_id=?;", [first.batch_id]);
						await sql.run("INSERT INTO sync_upload(id,local_epoch,server_url,request) VALUES(1,?,?,?);", [context.localEpoch, context.url, JSON.stringify(request)]);
						return journal(sql, context);
					});
					if (!next) break;
					await send(next);
				}
				await pull(); const status = await syncStatus(db); result.pending = status.pending; result.blocked = status.blocked;
				return result;
			} finally { running.delete(db); }
		},
	};
}
