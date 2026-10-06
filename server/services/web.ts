import { createUuid, type SyncAggregate } from "../../shared/domain/sync";
import { ServerProtocolError, syncLimits, syncProtocolVersion } from "../../shared/domain/protocol";
import { ServerWriteError } from "../../shared/domain/server";
import { replyWebState } from "../../shared/domain/web";
import type { ServerDatabase } from "../database/connection";
import { serverTables } from "../database/schema";
import { readServerState } from "../database/state";
import { aggregateSnapshot, type Identity } from "./storage";
import { readBinding } from "./read";
import { utcTimestamp } from "./validation";
export async function readWebState(database: ServerDatabase, input: unknown) {
	const binding = readBinding(input);
	return database.transaction(async sql => {
		// RR: the binding/cursor, registry, business rows and view IDs share one cut.
		const state = await readServerState(sql);
		if (state.instance_uuid !== binding.serverInstanceId || state.epoch_uuid !== binding.serverEpoch) throw new ServerWriteError("serverChanged");
		const identities = await sql.query<Identity>("SELECT uuid,entity,aggregate_uuid,version,deleted_at FROM sync_identities ORDER BY uuid LIMIT ?", [syncLimits.maxSnapshotRecords + 1]);
		if (identities.length > syncLimits.maxSnapshotRecords) throw new ServerProtocolError("snapshotLimit");
		const aggregates = [];
		for (const row of identities.filter(row => row.uuid === row.aggregate_uuid)) {
			const root = await aggregateSnapshot(sql, row.entity as SyncAggregate, row.uuid); if (!root) throw new ServerProtocolError("DB_READ_FAILED"); aggregates.push(root);
		}
		const viewIds = [];
		for (const entity of Object.keys(serverTables) as (keyof typeof serverTables)[]) {
			for (const row of await sql.query<{ uuid: string; id: number }>(`SELECT uuid,view_id AS id FROM ${entity}`)) viewIds.push({ entity, ...row });
		}
		const result = replyWebState({ snapshot: { ...binding, protocolVersion: syncProtocolVersion, snapshotId: createUuid(), cursor: String(state.last_cursor), expiresAt: new Date(Date.now() + 30_000).toISOString(), page: 0, pageCount: 1, nextPage: null, aggregates, identities: identities.map(row => ({ uuid: row.uuid, entity: row.entity, aggregateUuid: row.aggregate_uuid, version: row.version, deletedAt: row.deleted_at === null ? null : utcTimestamp(row.deleted_at, "deleted_at") })) }, viewIds }, binding);
		if (Buffer.byteLength(JSON.stringify(result)) > syncLimits.batchBytes) throw new ServerProtocolError("snapshotLimit");
		return result;
	});
}
