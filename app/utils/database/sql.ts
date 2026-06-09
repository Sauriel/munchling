import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { DATABASE_NAME } from "./schema";
import {
	initializeMunchlingDatabase,
	persistMunchlingDatabase,
} from "./client";

type SqlValue = string | number | boolean | null;

export async function executeSql(statements: string, transaction = true) {
	await initializeMunchlingDatabase();
	const result = await CapacitorSQLite.execute({
		database: DATABASE_NAME,
		statements,
		transaction,
	});
	await persistMunchlingDatabase();
	return result;
}

export async function runSql(statement: string, values: SqlValue[] = []) {
	await initializeMunchlingDatabase();
	const result = await CapacitorSQLite.run({
		database: DATABASE_NAME,
		statement,
		values,
	});
	await persistMunchlingDatabase();
	return result;
}

export async function querySql<Row extends Record<string, unknown>>(
	statement: string,
	values: SqlValue[] = [],
) {
	await initializeMunchlingDatabase();
	const result = await CapacitorSQLite.query({
		database: DATABASE_NAME,
		statement,
		values,
	});

	return (result.values ?? []) as Row[];
}

export function lastInsertId(result: Awaited<ReturnType<typeof runSql>>) {
	const id = result.changes?.lastId;

	if (typeof id !== "number") {
		throw new Error("SQLite did not return a last inserted id.");
	}

	return id;
}

export function toSqlBoolean(value: boolean) {
	return value ? 1 : 0;
}

export function fromSqlBoolean(value: unknown) {
	return Number(value) === 1;
}

export function normalizeOptionalText(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}
