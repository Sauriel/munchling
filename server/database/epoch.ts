import { createUuid } from "../../shared/domain/sync";
import type { ServerDatabase } from "./connection";
import { readServerState } from "./state";

// Administrative recovery only; deliberately NOT exposed through HTTP.
// Run after DB restore while app instances/writers are stopped. Never reset
// revisions/cursors or silently reuse receipts from the previous history.
export function rotateServerEpoch(database: ServerDatabase) {
	return database.transaction(async (sql) => {
		const state = await readServerState(sql, true), epoch = createUuid();
		await sql.write("UPDATE server_state SET epoch_uuid=? WHERE id=1", [epoch]);
		return { serverInstanceId: state.instance_uuid, serverEpoch: epoch, cursor: String(state.last_cursor) };
	});
}
