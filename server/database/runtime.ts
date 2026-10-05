import type { ServerDatabase } from "./connection";
let database: ServerDatabase | null = null;
export function installServerDatabase(value: ServerDatabase) {
	if (database) throw new Error("Server database already initialized.");
	database = value;
}
export function getServerDatabase() {
	if (!database) throw new Error("Server database is not initialized.");
	return database;
}
export function clearServerDatabase() { database = null; }
