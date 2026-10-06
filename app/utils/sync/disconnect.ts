import type { SqlDatabase, SqlExecutor } from "../database/executor";
import { snapshotBackup } from "../database/backup";
import { flushOutbox } from "../database/outbox";
import { cloneBackup, type MunchlingBackup } from "../../../shared/domain/backup";
import { createUuid } from "../../../shared/domain/sync";
import { SyncClientError } from "../../../shared/domain/replies";
import { digest, localDigest, uncertain } from "./decisions";
import { receiveState } from "./staging";
export type DisconnectReview = { token: string; url: string; roots: number; localEpoch: string };
async function review(sql: SqlExecutor): Promise<DisconnectReview> {
	const state = await receiveState(sql);
	if (!state.url || state.cursor === null) throw new SyncClientError("notInitialized");
	if (state.seeded) throw new SyncClientError("developmentSeeded");
	await uncertain(sql);
	return { token: await digest({ kind: "disconnect", local: await localDigest(sql) }), url: state.url, roots: (await sql.query<{ n: number }>("SELECT COUNT(*) AS n FROM sync_records WHERE uuid=aggregate_uuid AND deleted_at IS NULL;"))[0]!.n, localEpoch: state.localEpoch };
}
// Offline-capable, explicit local detachment. No HTTP request, server restore
// or household deletion. Reconnecting must pass initial reconciliation anew.
export function createSyncDisconnect(db: SqlDatabase, saveSafety: (backup: MunchlingBackup) => Promise<void>) {
	return {
		preview: () => db.transaction(review),
		commit: (token: string, confirmed = false) => db.transaction(async (sql) => {
			const current = await review(sql); if (current.token !== token) throw new SyncClientError("previewChanged");
			if (!confirmed) throw new SyncClientError("confirmDisconnect");
			await saveSafety(cloneBackup(await snapshotBackup(sql)));
			for (const statement of ["DELETE FROM sync_outbox;", "DELETE FROM sync_baselines;", "DELETE FROM sync_conflicts;", "DELETE FROM sync_inbox;", "DELETE FROM sync_download;", "DELETE FROM sync_dirty;"]) await sql.run(statement);
			await sql.run("UPDATE sync_records SET server_revision=0;");
			await sql.run("UPDATE sync_state SET enabled=0,server_url=NULL,server_instance_id=NULL,server_epoch=NULL,pull_cursor=NULL,local_epoch=?,tracking_enabled=1 WHERE id=1;", [createUuid()]);
			// UUIDs/numeric IDs/tombstones and latest business values stay intact;
			// old server-bound requests are replaced with unbound latest intents.
			await sql.run("INSERT INTO sync_dirty(entity,uuid) SELECT entity,uuid FROM sync_records WHERE uuid=aggregate_uuid;");
			await flushOutbox(sql);
			return { previousUrl: current.url, localEpoch: (await receiveState(sql)).localEpoch };
		}),
	};
}
