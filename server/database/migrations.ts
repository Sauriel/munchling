import { createHash } from "node:crypto";
import { createUuid } from "../../shared/domain/sync";
import type { ServerDatabase } from "./connection";
import { migrationTableSql, serverMigrations } from "./schema";

export function migrationChecksum(statements: string[]) { return createHash("sha256").update(JSON.stringify(statements)).digest("hex"); }
export async function migrateServerDatabase(database: ServerDatabase, databaseName: string, migrations = serverMigrations) {
	const lock = `munchling-schema:${createHash("sha256").update(databaseName).digest("hex").slice(0, 32)}`;
	await database.withConnection(async (sql) => {
		const acquired = (await sql.query<{ acquired: number | null }>("SELECT GET_LOCK(?,30) AS acquired", [lock]))[0]?.acquired;
		if (acquired !== 1) throw new Error("Could not acquire MariaDB migration lock.");
		try {
			await sql.write(migrationTableSql);
			const applied = await sql.query<{ version: number; checksum: string; status: string }>("SELECT version,checksum,status FROM schema_migrations ORDER BY version");
			for (const row of applied) {
				const migration = migrations.find((item) => item.version === row.version);
				if (!migration) throw new Error("MariaDB schema is newer than this server.");
				if (row.checksum !== migrationChecksum(migration.statements)) throw new Error("Applied MariaDB migration checksum does not match.");
				// MariaDB DDL commits implicitly: pretending that a failed DDL
				// migration rolled back would risk serving an incomplete schema.
				if (row.status !== "applied") throw new Error("Incomplete MariaDB migration requires operator inspection and repair.");
			}
			for (const migration of migrations) {
				if (applied.some((row) => row.version === migration.version)) continue;
				const checksum = migrationChecksum(migration.statements);
				await sql.write("INSERT INTO schema_migrations(version,name,checksum,status) VALUES (?,?,?,'applying')", [migration.version, migration.name, checksum]);
				for (const statement of migration.statements) await sql.write(statement);
				if (migration.version === 1) await sql.write("INSERT INTO server_state(id,instance_uuid,epoch_uuid) VALUES (1,?,?)", [createUuid(), createUuid()]);
				await sql.write("UPDATE schema_migrations SET status='applied',applied_at=UTC_TIMESTAMP(3) WHERE version=?", [migration.version]);
			}
		} finally { await sql.query("SELECT RELEASE_LOCK(?) AS released", [lock]); }
	});
}
