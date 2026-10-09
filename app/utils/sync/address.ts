import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { SyncClientError } from "../../../shared/domain/replies";
import { syncServerUrl } from "./http";
import { receiveState, stagedDownload } from "./staging";

async function currentAddress(sql: SqlExecutor) {
	const download = await stagedDownload(sql), state = await receiveState(sql);
	const draft = (await sql.query<{ draft_url: string | null }>('SELECT draft_url FROM sync_state WHERE id=1;'))[0]!.draft_url;
	return download?.row.server_url ?? state.url ?? draft ?? '';
}
async function checkedAddress(sql: SqlExecutor, value: string) {
	const url = value.trim() ? syncServerUrl(value.trim()) : null;
	const state = await receiveState(sql), download = await stagedDownload(sql);
	if (state.url && state.url !== url || download && download.row.server_url !== url) throw new SyncClientError('serverChanged');
	return url;
}
export function createSyncAddressSettings(db: SqlDatabase) {
	return {
		read: () => db.transaction(currentAddress),
		isTrusted: (value: string) => db.transaction(async sql => {
			let url: string;
			try { url = syncServerUrl(value.trim()); } catch { return false; }
			const row = (await sql.query<{ trusted_url: string | null; trusted_epoch: string | null; local_epoch: string }>('SELECT trusted_url,trusted_epoch,local_epoch FROM sync_state WHERE id=1;'))[0]!;
			return url === row.trusted_url && row.trusted_epoch === row.local_epoch && url === await currentAddress(sql);
		}),
		revoke: () => db.transaction(sql => sql.run('UPDATE sync_state SET trusted_url=NULL,trusted_epoch=NULL WHERE id=1;')),
		trust: (value: string) => db.transaction(async sql => {
			const url = await checkedAddress(sql,value);
			if (!url) throw new SyncClientError('invalidServerUrl');
			await sql.run('UPDATE sync_state SET draft_url=?,trusted_url=?,trusted_epoch=local_epoch WHERE id=1;', [url,url]);
			return url;
		}),
		remember: (value: string) => db.transaction(async sql => {
			const url = await checkedAddress(sql,value);
			await sql.run('UPDATE sync_state SET draft_url=?,trusted_epoch=CASE WHEN trusted_url=? THEN trusted_epoch ELSE NULL END,trusted_url=CASE WHEN trusted_url=? THEN trusted_url ELSE NULL END WHERE id=1;', [url,url,url]);
			return url ?? "";
		}),
	};
}
