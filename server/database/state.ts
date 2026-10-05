import type { ServerSql } from "./connection";
export type ServerState = { instance_uuid: string; epoch_uuid: string; last_cursor: number };
export async function readServerState(sql: ServerSql, lock = false): Promise<ServerState> {
	const statement = lock ? "SELECT instance_uuid,epoch_uuid,last_cursor FROM server_state WHERE id=1 FOR UPDATE" : "SELECT instance_uuid,epoch_uuid,last_cursor FROM server_state WHERE id=1";
	const state = (await sql.query<ServerState>(statement))[0];
	if (!state) throw new Error("MariaDB household state is not initialized.");
	return state;
}
