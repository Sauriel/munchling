import mariadb, { type Pool, type PoolConnection } from "mariadb";

export type DatabaseConfig = { host: string; port: number; user: string; password: string; database: string; connectionLimit: number };
export interface ServerSql {
	query<Row extends Record<string, unknown>>(statement: string, values?: unknown[]): Promise<Row[]>;
	write(statement: string, values?: unknown[]): Promise<void>;
}
export interface ServerDatabase {
	withConnection<T>(work: (sql: ServerSql) => Promise<T>): Promise<T>;
	transaction<T>(work: (sql: ServerSql) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

export function validateDatabaseConfig(value: DatabaseConfig): DatabaseConfig {
	if (!value.host || !value.user || !value.password || !/^[a-zA-Z0-9_]{1,64}$/.test(value.database)) throw new Error("Missing or invalid private MariaDB configuration.");
	if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 || !Number.isInteger(value.connectionLimit) || value.connectionLimit < 1 || value.connectionLimit > 32) throw new Error("Invalid MariaDB port or connection limit.");
	return value;
}
function executor(connection: PoolConnection, usable: () => boolean): ServerSql {
	const check = () => { if (!usable()) throw new Error("Server SQL executor is no longer active."); };
	return {
		query: async <Row extends Record<string, unknown>>(statement: string, values: unknown[] = []) => { check(); return connection.query<Row[]>(statement, values); },
		write: async (statement, values = []) => { check(); await connection.query(statement, values); },
	};
}
export function createServerDatabase(config: DatabaseConfig): ServerDatabase {
	const pool: Pool = mariadb.createPool({
		...validateDatabaseConfig(config), multipleStatements: false,
		charset: "utf8mb4", bigIntAsNumber: true, checkNumberRange: true, dateStrings: true, autoJsonMap: false,
		connectTimeout: 5000, acquireTimeout: 5000, queryTimeout: 5000, socketTimeout: 5000, idleTimeout: 60,
		initSql: ["SET time_zone='+00:00'", "SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"],
	});
	let closed = false;
	return {
		withConnection: async (work) => {
			const connection = await pool.getConnection();
			let usable = true;
			try { return await work(executor(connection, () => usable)); } finally { usable = false; connection.release(); }
		},
		transaction: async (work) => {
			const connection = await pool.getConnection();
			let active = false;
			let discarded = false;
			let usable = false;
			try {
				// Explicit isolation makes multi-query aggregate reads consistent too.
				await connection.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
				await connection.beginTransaction(); active = true;
				usable = true;
				const sql = executor(connection, () => usable);
				const result = await work(sql);
				usable = false;
				await connection.commit(); active = false;
				return result;
			} catch (error) {
				usable = false;
				if (active) {
					try { await connection.rollback(); }
					catch { discarded = true; connection.destroy(); throw new Error("MariaDB transaction rollback failed; connection discarded."); }
				}
				throw error;
			} finally { usable = false; if (!discarded) connection.release(); }
		},
		close: async () => { if (!closed) { closed = true; await pool.end(); } },
	};
}
