import { createServerDatabase, type ServerDatabase } from "../../server/database/connection";
import { migrateServerDatabase } from "../../server/database/migrations";
import { serverTables } from "../../server/database/schema";

export function testConfig() {
	const port = Number(process.env.MUNCHLING_TEST_DB_PORT);
	const password = process.env.MUNCHLING_TEST_DB_PASSWORD;
	if (!port || !password || process.env.MUNCHLING_TEST_DB_HOST !== "127.0.0.1") throw new Error("Run pnpm test:server: it creates an isolated loopback MariaDB container.");
	return { host: "127.0.0.1", port, user: "munchling_test", password, database: "munchling_test", connectionLimit: 5 };
}
export const newDatabase = () => createServerDatabase(testConfig());
export async function resetDatabase(database: ServerDatabase, migrate = true) {
	await database.withConnection(async (sql) => {
		await sql.write("SET foreign_key_checks=0");
		try {
			// Trusted fixture-only table names, never a user/production database.
			const tables = ["change_log", "write_operations", "write_batches", "sync_devices", ...Object.keys(serverTables), "sync_identities", "server_state", "schema_migrations"];
			for (const table of tables) await sql.write(`DROP TABLE IF EXISTS ${table}`);
		} finally { await sql.write("SET foreign_key_checks=1"); }
	});
	if (migrate) await migrateServerDatabase(database, "munchling_test");
}
