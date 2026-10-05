import type { MunchlingBackup } from "../../../shared/domain/backup";
import { snapshotBackup } from "./backup";
import type { SqlDatabase } from "./executor";
import { flushOutbox } from "./outbox";
import { schemaMigrations } from "./schema";

export async function runLocalMigrations(
	database: SqlDatabase,
	saveBeforeUpgrade: (backup: MunchlingBackup) => Promise<void>,
	migrations = schemaMigrations,
) {
	await database.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
	 version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`);
	const versions = await database.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version;");
	const applied = new Set(versions.map((row) => row.version));
	if (versions.some((row) => !schemaMigrations.some((migration) => migration.version === row.version))) throw new Error("Database schema is newer than this app.");
	for (const migration of migrations) {
		if (applied.has(migration.version)) continue;
		await database.transaction(async (sql) => {
			if (migration.version === 2) {
				const previous = await snapshotBackup(sql);
				// A fresh empty install has nothing to protect; existing data must
				// be saved independently BEFORE ALTER/backfill/trigger creation.
				if (Object.values(previous.data).some((rows) => rows.length)) await saveBeforeUpgrade(previous);
			}
			await sql.execute(migration.statements, false);
			await sql.run("INSERT INTO schema_migrations (version,name) VALUES (?,?);", [migration.version, migration.name]);
			if (migration.version === 2) await flushOutbox(sql);
		});
		applied.add(migration.version);
	}
}
