import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { DATABASE_NAME } from "./schema";
import { testDataSeedStatements } from "./seed";
import { createSqlDatabase, type SqlDriver } from "./executor";
import { runLocalMigrations } from "./migrations";
import { flushOutbox } from "./outbox";
import { saveMigrationBackup } from "../backup/files";

export type DatabaseInitOptions = {
	seedTestData?: boolean;
};

let initializationPromise: Promise<void> | null = null;
let webStoreInitialized = false;
let connectionCreated = false;

const databaseOptions = {
	database: DATABASE_NAME,
	readonly: false,
};

const connectionOptions = {
	database: DATABASE_NAME,
	version: 1,
	encrypted: false,
	mode: "no-encryption",
	readonly: false,
};

async function initializeWebStore() {
	if (Capacitor.getPlatform() !== "web" || webStoreInitialized) {
		return;
	}

	await CapacitorSQLite.initWebStore();
	webStoreInitialized = true;
}

export async function openMunchlingDatabase() {
	await initializeWebStore();

	if (!connectionCreated) {
		await CapacitorSQLite.createConnection(connectionOptions);
		connectionCreated = true;
	}

	await CapacitorSQLite.open(databaseOptions);
	await CapacitorSQLite.execute({
		database: DATABASE_NAME,
		statements: "PRAGMA foreign_keys = ON;",
		transaction: false,
	});
}

export async function closeMunchlingDatabase() {
	await CapacitorSQLite.close(databaseOptions);

	if (connectionCreated) {
		await CapacitorSQLite.closeConnection(databaseOptions);
		connectionCreated = false;
	}
}

export function createCapacitorSqlDriver(initialize: () => Promise<void> = async () => {}): SqlDriver {
	return {
		initialize,
		execute: (statements, transaction = true) => CapacitorSQLite.execute({ ...databaseOptions, statements, transaction }),
		run: (statement, values = []) => CapacitorSQLite.run({ ...databaseOptions, statement, values, transaction: false }),
		query: async <Row extends Record<string, unknown>>(statement: string, values = []): Promise<Row[]> => {
			const result = await CapacitorSQLite.query({ ...databaseOptions, statement, values });
			return (result.values ?? []) as Row[];
		},
		begin: async () => { await CapacitorSQLite.beginTransaction(databaseOptions); },
		commit: async () => { await CapacitorSQLite.commitTransaction(databaseOptions); },
		rollback: async () => { await CapacitorSQLite.rollbackTransaction(databaseOptions); },
		persist: persistMunchlingDatabase,
	};
}

export async function runDatabaseMigrations() {
	// Startup uses an uninitialized driver: re-entering the main facade here
	// would await its own initialization promise (deadlock).
	await runLocalMigrations(createSqlDatabase(createCapacitorSqlDriver()), saveMigrationBackup);
}

export async function seedDatabaseWithTestData() {
	await createSqlDatabase(createCapacitorSqlDriver(), flushOutbox).transaction(async (sql) => {
		await sql.execute(testDataSeedStatements, false);
		// Never let an automatically seeded development installation upload.
		await sql.run("UPDATE sync_state SET enabled=0,development_seeded=1 WHERE id=1;");
	});
}

export async function persistMunchlingDatabase() {
	if (Capacitor.getPlatform() === "web") {
		await CapacitorSQLite.saveToStore({ database: DATABASE_NAME });
	}
}

export async function initializeMunchlingDatabase(
	options: DatabaseInitOptions = {},
) {
	initializationPromise ??= (async () => {
		await openMunchlingDatabase();
		await runDatabaseMigrations();

		if (options.seedTestData) {
			await seedDatabaseWithTestData();
		}

		await persistMunchlingDatabase();
	})().catch((error) => {
		// A failed migration/safety write is retryable; its transaction rolled back.
		initializationPromise = null;
		throw error;
	});

	return initializationPromise;
}
