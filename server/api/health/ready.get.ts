import { defineEventHandler, setResponseStatus } from "h3";
import { getServerDatabase } from "../../database/runtime";
import { readServerState } from "../../database/state";
import { serverMigrations } from "../../database/schema";

export default defineEventHandler(async (event) => {
	try {
		await getServerDatabase().withConnection(async (sql) => {
			await readServerState(sql);
			const rows = await sql.query<{ version: number; status: string }>("SELECT version,status FROM schema_migrations ORDER BY version");
			if (rows.length !== serverMigrations.length || rows.some((row, index) => row.version !== serverMigrations[index]?.version || row.status !== "applied")) throw new Error("Schema not ready.");
		});
		return { status: "ready" };
	} catch {
		setResponseStatus(event, 503);
		// No credentials, SQL, EANs, names or stored payloads in logs/responses.
		console.warn(JSON.stringify({ event: "database_not_ready", code: "DB_NOT_READY" }));
		return { status: "unavailable", code: "DB_NOT_READY" };
	}
});
