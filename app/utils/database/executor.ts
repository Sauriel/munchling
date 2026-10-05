export type SqlValue = string | number | boolean | null;
export type SqlChanges = { changes?: { changes?: number; lastId?: number } };

export interface SqlExecutor {
	execute(statements: string, transaction?: boolean): Promise<SqlChanges>;
	run(statement: string, values?: SqlValue[]): Promise<SqlChanges>;
	query<Row extends Record<string, unknown>>(statement: string, values?: SqlValue[]): Promise<Row[]>;
}

export interface SqlDatabase extends SqlExecutor {
	transaction<T>(work: (sql: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface SqlDriver extends SqlExecutor {
	initialize(): Promise<void>;
	begin(): Promise<void>;
	commit(): Promise<void>;
	rollback(): Promise<void>;
	persist(): Promise<void>;
}

// One connection, one queue: unrelated queries/writes cannot enter another
// operation's transaction. Transaction callbacks MUST use their scoped executor.
export function createSqlDatabase(driver: SqlDriver, beforeCommit?: (sql: SqlExecutor) => Promise<void>): SqlDatabase {
	let queue: Promise<unknown> = Promise.resolve();
	let unusable = false;

	const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
		const result = queue.then(async () => {
			if (unusable) throw new Error("Database connection needs reopening after rollback failure.");
			await driver.initialize();
			return work();
		});
		queue = result.catch(() => undefined);
		return result;
	};

	const normalizeValues = (values: SqlValue[]) => values.map((value) => typeof value === "boolean" ? Number(value) : value);

	const database: SqlDatabase = {
		execute: (statements, transaction = true) => beforeCommit
			? database.transaction((sql) => sql.execute(statements, false))
			: exclusive(async () => {
			const result = await driver.execute(statements, transaction);
			await driver.persist();
			return result;
		}),
		run: (statement, values = []) => beforeCommit
			? database.transaction((sql) => sql.run(statement, values))
			: exclusive(async () => {
			const result = await driver.run(statement, normalizeValues(values));
			await driver.persist();
			return result;
		}),
		query: (statement, values = []) => exclusive(() => driver.query(statement, normalizeValues(values))),
		transaction: <T>(work: (sql: SqlExecutor) => Promise<T>) => exclusive(async () => {
			await driver.begin();
			let active = true;
			const checkActive = () => {
				if (!active) throw new Error("Transaction executor is no longer active.");
			};
			const scoped: SqlExecutor = {
				execute: async (statements) => { checkActive(); return driver.execute(statements, false); },
				run: async (statement, values = []) => { checkActive(); return driver.run(statement, normalizeValues(values)); },
				query: async (statement, values = []) => { checkActive(); return driver.query(statement, normalizeValues(values)); },
			};
			let result: T;
			try {
				result = await work(scoped);
				if (beforeCommit) await beforeCommit(scoped);
				await driver.commit();
			} catch (error) {
				try {
					await driver.rollback();
				} catch (rollbackError) {
					// Never admit more operations into a possibly still active transaction.
					unusable = true;
					throw new AggregateError([error, rollbackError], "Transaction and rollback failed.");
				}
				throw error;
			} finally {
				active = false;
			}
			// A persistence error after commit is not a rollback-able SQL failure.
			await driver.persist();
			return result;
		}),
	};
	return database;
}

export function lastInsertId(result: SqlChanges) {
	const id = result.changes?.lastId;
	if (typeof id !== "number") throw new Error("SQLite did not return a last inserted id.");
	return id;
}

export function toSqlBoolean(value: boolean) { return value ? 1 : 0; }
export function fromSqlBoolean(value: unknown) { return Number(value) === 1; }
export function normalizeOptionalText(value: string | null | undefined) {
	return value?.trim() || null;
}
