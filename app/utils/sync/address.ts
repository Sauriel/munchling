import type { SqlDatabase } from "../database/executor";
import { SyncClientError } from "../../../shared/domain/replies";
import { syncServerUrl } from "./http";
import { receiveState, stagedDownload } from "./staging";

export function createSyncAddressSettings(db: SqlDatabase) {
	return {
		read: () => db.transaction(async sql => {
			const download = await stagedDownload(sql), state = await receiveState(sql);
			const draft = (await sql.query<{ draft_url: string | null }>("SELECT draft_url FROM sync_state WHERE id=1;"))[0]!.draft_url;
			return download?.row.server_url ?? state.url ?? draft ?? "";
		}),
		remember: (value: string) => db.transaction(async sql => {
			const url = value.trim() ? syncServerUrl(value.trim()) : null;
			const state = await receiveState(sql), download = await stagedDownload(sql);
			if (state.url && state.url !== url || download && download.row.server_url !== url) throw new SyncClientError("serverChanged");
			await sql.run("UPDATE sync_state SET draft_url=? WHERE id=1;", [url]);
			return url ?? "";
		}),
	};
}
