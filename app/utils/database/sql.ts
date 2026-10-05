import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { DATABASE_NAME } from "./schema";
import { initializeMunchlingDatabase, persistMunchlingDatabase } from "./client";
import { createSqlDatabase } from "./executor";

export { lastInsertId, toSqlBoolean, fromSqlBoolean, normalizeOptionalText } from "./executor";
export type { SqlDatabase, SqlExecutor, SqlValue } from "./executor";

const options = { database: DATABASE_NAME, readonly: false };

export const databaseSql = createSqlDatabase({
	initialize: () => initializeMunchlingDatabase(),
	execute: (statements, transaction = true) => CapacitorSQLite.execute({ ...options, statements, transaction }),
	// The outer executor owns transactions. Capacitor must not implicitly start
	// a nested transaction for each statement in an aggregate.
	run: (statement, values = []) => CapacitorSQLite.run({ ...options, statement, values, transaction: false }),
	query: async <Row extends Record<string, unknown>>(statement: string, values = []): Promise<Row[]> => {
		const result = await CapacitorSQLite.query({ ...options, statement, values });
		return (result.values ?? []) as Row[];
	},
	begin: async () => { await CapacitorSQLite.beginTransaction(options); },
	commit: async () => { await CapacitorSQLite.commitTransaction(options); },
	rollback: async () => { await CapacitorSQLite.rollbackTransaction(options); },
	persist: persistMunchlingDatabase,
});

// Compatibility for existing low-level callers. All access shares the queue.
export const executeSql = databaseSql.execute;
export const runSql = databaseSql.run;
export const querySql = databaseSql.query;
