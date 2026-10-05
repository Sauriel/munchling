import initSqlJs from "sql.js";
import { vi } from "vitest";
import { createSqlDatabase, type SqlDriver, type SqlValue } from "../../app/utils/database/executor";
import { schemaMigrations } from "../../app/utils/database/schema";
import { createLocalDataService } from "../../app/utils/data/local";

// Real SQLite (WASM), not mocked SQL: constraints, cascades and rollback are
// exercised against the same schema used by the native app.
export async function createTestDatabase() {
	const SQL = await initSqlJs();
	const sqlite = new SQL.Database();
	for (const migration of schemaMigrations) sqlite.run(migration.statements);
	const persist = vi.fn(async () => {});
	const bind = (values: SqlValue[]) => values.map((value) => typeof value === "boolean" ? Number(value) : value);
	const driver: SqlDriver = {
		initialize: async () => {},
		execute: async (statements, transaction = true) => {
			if (transaction) sqlite.run("BEGIN TRANSACTION;");
			try {
				sqlite.run(statements);
				if (transaction) sqlite.run("COMMIT;");
				return { changes: { changes: sqlite.getRowsModified() } };
			} catch (error) {
				if (transaction) sqlite.run("ROLLBACK;");
				throw error;
			}
		},
		run: async (statement, values = []) => {
			sqlite.run(statement, bind(values));
			return {
				changes: {
					changes: sqlite.getRowsModified(),
					lastId: Number(sqlite.exec("SELECT last_insert_rowid();")[0]?.values[0]?.[0]),
				},
			};
		},
		query: async <Row extends Record<string, unknown>>(statement: string, values: SqlValue[] = []): Promise<Row[]> => {
			const prepared = sqlite.prepare(statement);
			try {
				prepared.bind(bind(values));
				const rows: Row[] = [];
				while (prepared.step()) rows.push(prepared.getAsObject() as Row);
				return rows;
			} finally { prepared.free(); }
		},
		begin: async () => { sqlite.run("BEGIN TRANSACTION;"); },
		commit: async () => { sqlite.run("COMMIT;"); },
		rollback: async () => { sqlite.run("ROLLBACK;"); },
		persist,
	};
	const database = createSqlDatabase(driver);
	return { database, driver, service: createLocalDataService(database), persist, close: () => sqlite.close() };
}
