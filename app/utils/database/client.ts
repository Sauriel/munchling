import { Capacitor } from "@capacitor/core";
import { CapacitorSQLite } from "@capacitor-community/sqlite";
import { DATABASE_NAME, schemaMigrations } from "./schema";
import { testDataSeedStatements } from "./seed";

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

export async function runDatabaseMigrations() {
	await CapacitorSQLite.execute({
		database: DATABASE_NAME,
		statements: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
	});

	const appliedResult = await CapacitorSQLite.query({
		database: DATABASE_NAME,
		statement: "SELECT version FROM schema_migrations ORDER BY version ASC;",
		values: [],
	});
	const appliedVersions = new Set(
		(appliedResult.values ?? []).map((row) => Number(row.version)),
	);

	for (const migration of schemaMigrations) {
		if (appliedVersions.has(migration.version)) {
			continue;
		}

		await CapacitorSQLite.execute({
			database: DATABASE_NAME,
			statements: migration.statements,
			transaction: true,
		});
		await CapacitorSQLite.run({
			database: DATABASE_NAME,
			statement: "INSERT INTO schema_migrations (version, name) VALUES (?, ?);",
			values: [migration.version, migration.name],
		});
	}
}

export async function seedDatabaseWithTestData() {
	await CapacitorSQLite.execute({
		database: DATABASE_NAME,
		statements: testDataSeedStatements,
		transaction: true,
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
	})();

	return initializationPromise;
}
