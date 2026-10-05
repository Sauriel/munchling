import { createCapacitorSqlDriver, initializeMunchlingDatabase } from "./client";
import { createSqlDatabase } from "./executor";
import { flushOutbox } from "./outbox";

export { lastInsertId, toSqlBoolean, fromSqlBoolean, normalizeOptionalText } from "./executor";
export type { SqlDatabase, SqlExecutor, SqlValue } from "./executor";

export const databaseSql = createSqlDatabase(createCapacitorSqlDriver(() => initializeMunchlingDatabase()), flushOutbox);

// Compatibility for existing low-level callers. All access shares the queue.
export const executeSql = databaseSql.execute;
export const runSql = databaseSql.run;
export const querySql = databaseSql.query;
