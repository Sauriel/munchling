import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { isUuid } from "../../../shared/domain/sync";
import type { ServerBinding, SnapshotPage } from "../../../shared/domain/protocol";
import { syncLimits } from "../../../shared/domain/protocol";
import { replyAggregate, replySnapshot, SyncClientError } from "../../../shared/domain/replies";
import { completeSnapshot } from "../../../shared/domain/snapshot";
import { syncServerUrl } from "./http";
export type ReceiveState = ServerBinding & { localEpoch: string; url: string | null; cursor: string | null; enabled: boolean; seeded: boolean };
export async function receiveState(sql: SqlExecutor): Promise<ReceiveState> {
	const row = (await sql.query<{ local_epoch: string; server_url: string | null; server_instance_id: string | null; server_epoch: string | null; pull_cursor: string | null; enabled: number; development_seeded: number }>("SELECT local_epoch,server_url,server_instance_id,server_epoch,pull_cursor,enabled,development_seeded FROM sync_state WHERE id=1;"))[0];
	if (!row) throw new SyncClientError("localStateMissing");
	return { localEpoch: row.local_epoch, url: row.server_url, serverInstanceId: row.server_instance_id ?? "", serverEpoch: row.server_epoch ?? "", cursor: row.pull_cursor, enabled: row.enabled === 1, seeded: row.development_seeded === 1 };
}
export function checkLocalContext(state: ReceiveState, localEpoch: string, url: string, binding: ServerBinding) {
	if (state.localEpoch !== localEpoch) throw new SyncClientError("localReset", true);
	if (state.seeded) throw new SyncClientError("developmentSeeded");
	if (state.url !== null && (state.url !== url || state.serverInstanceId !== binding.serverInstanceId || state.serverEpoch !== binding.serverEpoch)) throw new SyncClientError("serverChanged", true);
}
export function storedJson<T>(text: string): T {
	try { return JSON.parse(text) as T; } catch { throw new SyncClientError("corruptStaging"); }
}
type Download = { id: string; local_epoch: string; server_url: string; server_instance_id: string; server_epoch: string; manifest: string; next_page: number };
export async function stagedDownload(sql: SqlExecutor) {
	const row = (await sql.query<Download>("SELECT * FROM sync_download WHERE slot=1;"))[0];
	if (!row) return null;
	checkLocalContext(await receiveState(sql), row.local_epoch, row.server_url, { serverInstanceId: row.server_instance_id, serverEpoch: row.server_epoch });
	const manifest = replySnapshot(storedJson(row.manifest), { serverInstanceId: row.server_instance_id, serverEpoch: row.server_epoch }, 0);
	if (manifest.snapshotId !== row.id || !Number.isSafeInteger(row.next_page) || row.next_page < 1 || row.next_page > manifest.pageCount) throw new SyncClientError("corruptStaging");
	return { row, manifest };
}
export async function stagedSnapshot(sql: SqlExecutor) {
	const download = await stagedDownload(sql); if (!download) throw new SyncClientError("downloadMissing");
	const rows = await sql.query<{ page_index: number; payload: string }>("SELECT page_index,payload FROM sync_download_pages WHERE download_id=? ORDER BY page_index;", [download.row.id]);
	if (rows.length !== download.manifest.pageCount || rows.some((row, index) => row.page_index !== index)) throw new SyncClientError("incompleteSnapshot");
	const pages = rows.map((row) => replySnapshot(storedJson(row.payload), download.manifest, row.page_index, download.manifest));
	const bytes = pages.reduce((sum, page) => sum + new TextEncoder().encode(JSON.stringify({ aggregates: page.aggregates, identities: page.identities })).byteLength, 0);
	if (bytes > syncLimits.maxSnapshotBytes || pages.reduce((sum, page) => sum + page.aggregates.length + page.identities.length, 0) > syncLimits.maxSnapshotRecords) throw new SyncClientError("responseTooLarge");
	return { ...download, snapshot: completeSnapshot(pages) };
}
export function createSnapshotStaging(db: SqlDatabase) {
	return {
		state: () => db.transaction(receiveState),
		begin: async (localEpoch: string, url: string, input: SnapshotPage) => {
			const address = syncServerUrl(url), page = replySnapshot(storedJson<SnapshotPage>(JSON.stringify(input)), input, 0);
			const text = JSON.stringify(page);
			if (new TextEncoder().encode(text).byteLength > syncLimits.batchBytes + 64 * 1024) throw new SyncClientError("responseTooLarge");
			if (!isUuid(localEpoch) || !isUuid(page.serverInstanceId) || !isUuid(page.serverEpoch)) throw new SyncClientError("invalidResponse");
			return db.transaction(async (sql) => {
				checkLocalContext(await receiveState(sql), localEpoch, address, page);
				if ((await sql.query("SELECT id FROM sync_download;")).length) throw new SyncClientError("downloadExists");
				const manifest = { ...page, aggregates: [], identities: [] };
				await sql.run("INSERT INTO sync_download(id,local_epoch,server_url,server_instance_id,server_epoch,manifest,next_page) VALUES (?,?,?,?,?,?,1);", [page.snapshotId, localEpoch, address, page.serverInstanceId, page.serverEpoch, JSON.stringify(manifest)]);
				await sql.run("INSERT INTO sync_download_pages(download_id,page_index,payload) VALUES (?,0,?);", [page.snapshotId, text]);
			});
		},
		save: async (input: SnapshotPage) => db.transaction(async (sql) => {
			const download = await stagedDownload(sql); if (!download) throw new SyncClientError("downloadMissing");
			const page = replySnapshot(input, download.manifest, input.page, download.manifest), text = JSON.stringify(page);
			if (new TextEncoder().encode(text).byteLength > syncLimits.batchBytes + 64 * 1024) throw new SyncClientError("responseTooLarge");
			const previous = (await sql.query<{ payload: string }>("SELECT payload FROM sync_download_pages WHERE download_id=? AND page_index=?;", [download.row.id, page.page]))[0];
			if (previous) { if (previous.payload !== text) throw new SyncClientError("changedSnapshot"); return; }
			if (page.page !== download.row.next_page) throw new SyncClientError("incompleteSnapshot");
			const sizes = (await sql.query<{ bytes: number }>("SELECT COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM sync_download_pages WHERE download_id=?;", [download.row.id]))[0]!;
			if (sizes.bytes + new TextEncoder().encode(text).byteLength > syncLimits.maxSnapshotBytes + syncLimits.maxSnapshotPages * 1024) throw new SyncClientError("responseTooLarge");
			await sql.run("INSERT INTO sync_download_pages(download_id,page_index,payload) VALUES (?,?,?);", [download.row.id, page.page, text]);
			await sql.run("UPDATE sync_download SET next_page=? WHERE id=?;", [page.page + 1, download.row.id]);
		}),
		progress: () => db.transaction(async (sql) => { const download = await stagedDownload(sql); return download ? { ...download, ready: download.row.next_page === download.manifest.pageCount } : null; }),
		audit: () => db.transaction(async (sql) => {
			const download = await stagedDownload(sql); if (!download) return null;
			const rows = await sql.query<{ page_index: number; payload: string }>("SELECT page_index,payload FROM sync_download_pages WHERE download_id=? ORDER BY page_index;", [download.row.id]);
			if (rows.length !== download.row.next_page || rows.some((row, index) => row.page_index !== index)) throw new SyncClientError("corruptStaging");
			const ids = new Set<string>(), registry = new Set<string>(); let bytes = 0, records = 0;
			for (const row of rows) {
				const page = replySnapshot(storedJson(row.payload), download.manifest, row.page_index, download.manifest);
				for (const root of page.aggregates) replyAggregate(root, ids);
				for (const identity of page.identities) { if (registry.has(identity.uuid)) throw new SyncClientError("corruptStaging"); registry.add(identity.uuid); }
				bytes += new TextEncoder().encode(JSON.stringify({ aggregates: page.aggregates, identities: page.identities })).byteLength; records += page.aggregates.length + page.identities.length;
			}
			if (bytes > syncLimits.maxSnapshotBytes || records > syncLimits.maxSnapshotRecords) throw new SyncClientError("responseTooLarge");
			return { ...download, ready: download.row.next_page === download.manifest.pageCount };
		}),
		complete: () => db.transaction(stagedSnapshot),
		discard: () => db.transaction(async (sql) => { await sql.run("DELETE FROM sync_download;"); }),
	};
}
